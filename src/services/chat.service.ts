import { prisma } from '../config/db';
import { getAgent } from '../agents/index';

// ─── Thread ID scoping ────────────────────────────────────────────────────────

/** Prefixes threadId with userId — users can never access each other's threads */
export function scopeThreadId(userId: number, threadId?: string): string {
  return `user-${userId}-${threadId ?? 'default'}`;
}

// ─── Persist a user message ───────────────────────────────────────────────────

export async function persistUserMessage(
  userId: number,
  threadId: string,
  content: string,
): Promise<void> {
  await prisma.chatMessage.create({
    data: { userId, threadId, role: 'user', content },
  });
}

// ─── Get chat history ─────────────────────────────────────────────────────────
// FIX: reads from the LangGraph checkpoint state so history is always
// complete and up-to-date (includes AI responses, not just user messages).
// Falls back to the ChatMessage table if the checkpoint has no state yet.

export async function getChatHistoryService(
  userId: number,
  threadId: string,
  limit: number,
) {
  try {
    // Get the agent for this user/thread — it holds the compiled graph
    // with the PostgresSaver checkpointer attached.
    const agent = await getAgent(userId, threadId);

    // getState returns the latest checkpoint for this thread.
    const state = await agent.getState({
      configurable: { thread_id: threadId },
    });

    if (state?.values?.messages?.length) {
      // LangGraph BaseMessage objects have a `_getType()` method and a
      // `content` field. Map them to a shape the frontend already expects.
      const messages = state.values.messages as Array<{
        _getType?: () => string;
        getType?: () => string;
        content: unknown;
        id?: string;
        response_metadata?: Record<string, unknown>;
      }>;

      const mapped = messages
        .map((m, idx) => {
          // Support both old and new LangGraph message API
          const type =
            typeof m.getType === 'function'
              ? m.getType()
              : typeof m._getType === 'function'
                ? m._getType()
                : 'unknown';

          // Skip tool call / tool result messages — only show human + ai
          if (type !== 'human' && type !== 'ai') return null;

          // Skip empty AI messages (e.g. tool-calling intermediate steps)
          const content =
            typeof m.content === 'string'
              ? m.content
              : JSON.stringify(m.content);
          if (!content || content === '[]' || content === '""') return null;

          return {
            id: idx,
            threadId,
            role: type === 'human' ? 'user' : 'assistant',
            content,
            createdAt: new Date(),
          };
        })
        .filter(Boolean);

      // Apply limit from the end (most recent messages)
      return mapped.slice(-limit);
    }
  } catch (err) {
    // If checkpoint read fails for any reason, fall through to DB fallback
    console.error(
      '[getChatHistory] checkpoint read failed, falling back to DB:',
      err,
    );
  }

  // ── Fallback: read from ChatMessage table ────────────────────────────────
  // This covers threads that were created before PostgresSaver was introduced.
  return prisma.chatMessage.findMany({
    where: { userId, threadId },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      threadId: true,
      role: true,
      content: true,
      createdAt: true,
    },
  });
}

// ─── Delete chat history ──────────────────────────────────────────────────────

export async function deleteChatHistoryService(
  userId: number,
  threadId?: string,
): Promise<number> {
  const where = threadId ? { userId, threadId } : { userId };
  const { count } = await prisma.chatMessage.deleteMany({ where });
  return count;
}
