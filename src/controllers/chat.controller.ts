import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest, StreamMessage } from '../types/index';
import type { ChatQueryInput } from '../lib/schemas';
import { getAgent, enforceAiMessageLimit } from '../agents/index';
import {
  scopeThreadId,
  persistUserMessage,
  persistAssistantMessage,
  getChatHistoryService,
  deleteChatHistoryService,
} from '../services/chat.service';
import { AppError } from '../middleware/errorHandler';

// ─── POST /api/chat ───────────────────────────────────────────────────────────

export async function streamChat(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = (req as AuthenticatedRequest).user.sub;
  const { query, threadId } = req.body as ChatQueryInput;
  const scopedThreadId = scopeThreadId(userId, threadId);

  // ── Plan limit check ───────────────────────────────────────────────────────
  try {
    await enforceAiMessageLimit(userId);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    next(err);
    return;
  }

  // ── SSE setup ──────────────────────────────────────────────────────────────
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const writeEvent = (eventName: string, data: StreamMessage): void => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let isConnected = true;
  req.on('close', () => {
    isConnected = false;
  });

  // Accumulate all AI text chunks into one final response
  const aiResponseChunks: string[] = [];

  try {
    const agent = await getAgent(userId, scopedThreadId);

    const responseStream = await agent.stream(
      { messages: [{ role: 'user', content: query }] },
      {
        streamMode: 'messages',
        configurable: { thread_id: scopedThreadId },
      },
    );

    for await (const chunk of responseStream) {
      if (!isConnected) break;

      const arr = chunk as unknown as unknown[];
      const msg = arr[0] as Record<string, unknown>;

      if (!msg) continue;

      const content = msg['content'];
      const name = msg['name'] as string | undefined;
      const toolCalls = msg['tool_calls'];
      const toolCallChunks = msg['tool_call_chunks'];

      if (content === '' || content === undefined || content === null) continue;

      // ── Tool result (message returned BY a tool) ──────────────────────────
      // Has a name field (the tool name), content is the JSON result string
      if (name !== undefined && typeof content === 'string') {
        let result: Record<string, unknown>;
        try {
          result = JSON.parse(content) as Record<string, unknown>;
        } catch {
          result = { raw: content };
        }
        writeEvent('messages', {
          type: 'tool',
          payload: { name, result },
        });
        continue;
      }

      // ── AI is invoking a tool (tool_calls present and non-empty) ─────────
      // content here is empty or a partial thought — skip for history
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        continue;
      }

      if (Array.isArray(toolCallChunks) && toolCallChunks.length > 0) {
        continue;
      }

      // ── Plain AI text response ─────────────────────────────────────────────
      if (typeof content === 'string' && content !== '') {
        aiResponseChunks.push(content);
        writeEvent('messages', {
          type: 'ai',
          payload: { text: content },
        });
      }
    }

    // ── Persist both messages after stream completes ───────────────────────
    const fullAiResponse = aiResponseChunks.join('');

    await Promise.all([
      persistUserMessage(userId, scopedThreadId, query),
      persistAssistantMessage(userId, scopedThreadId, fullAiResponse),
    ]);
  } catch (err) {
    console.error('[Chat stream error]', err);
    if (isConnected) {
      writeEvent('error', {
        type: 'error',
        payload: { text: 'An error occurred. Please try again.' },
      });
    }
    next(err);
  } finally {
    res.end();
  }
}

// ─── GET /api/chat/history ────────────────────────────────────────────────────

export async function getChatHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { threadId, limit = '50' } = req.query as {
      threadId?: string;
      limit?: string;
    };
    const scopedThreadId = scopeThreadId(userId, threadId);
    const messages = await getChatHistoryService(
      userId,
      scopedThreadId,
      parseInt(limit, 10),
    );
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/chat/history ─────────────────────────────────────────────────

export async function deleteChatHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { threadId } = req.query as { threadId?: string };
    const scopedThreadId = threadId
      ? scopeThreadId(userId, threadId)
      : undefined;
    const count = await deleteChatHistoryService(userId, scopedThreadId);
    res.json({ success: true, message: `${count} message(s) deleted` });
  } catch (err) {
    next(err);
  }
}
