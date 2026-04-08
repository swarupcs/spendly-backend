import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest, StreamMessage } from '../types/index';
import type { ChatQueryInput } from '../lib/schemas';
import { getAgent, enforceAiMessageLimit } from '../agents/index';
import {
  scopeThreadId,
  persistUserMessage,
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

  try {
    const agent = getAgent(userId);

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
      const msg = arr[0] as {
        content?: unknown;
        name?: string;
        tool_calls?: unknown[];
        tool_call_chunks?: unknown[];
        constructor?: { name?: string };
      };

      if (!msg || msg.content === '' || msg.content === undefined) continue;

      let message: StreamMessage | null = null;

      const isToolMessage =
        msg.tool_calls === undefined && msg.tool_call_chunks === undefined;
      const isAIChunk =
        msg.tool_calls !== undefined || msg.tool_call_chunks !== undefined;

      if (isToolMessage && typeof msg.content === 'string') {
        let result: Record<string, unknown>;
        try {
          result = JSON.parse(msg.content) as Record<string, unknown>;
        } catch {
          result = { raw: msg.content };
        }
        message = {
          type: 'tool',
          payload: { name: msg.name ?? 'unknown', result },
        };
      } else if (
        isAIChunk &&
        typeof msg.content === 'string' &&
        msg.content !== ''
      ) {
        message = { type: 'ai', payload: { text: msg.content } };
      }

      if (message) writeEvent('messages', message);
    }

    // Persist user message (fire-and-forget)
    persistUserMessage(userId, scopedThreadId, query).catch(console.error);
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
