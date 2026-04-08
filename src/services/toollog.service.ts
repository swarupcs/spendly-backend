import { prisma } from '../config/db';

export interface ToolCallRecord {
  userId: number;
  threadId?: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  durationMs?: number;
  success: boolean;
  error?: string;
}

/**
 * Persists a tool call to the ToolCallLog table.
 * Fire-and-forget — never throws, never blocks the agent.
 *
 * NOTE: Requires the ToolCallLog model in schema.prisma.
 * See SCHEMA_ADDITIONS.prisma for the migration.
 */
export async function logToolCall(record: ToolCallRecord): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).toolCallLog.create({
      data: {
        userId: record.userId,
        threadId: record.threadId ?? null,
        toolName: record.toolName,
        args: record.args,
        result: record.result ?? null,
        durationMs: record.durationMs ?? null,
        success: record.success,
        error: record.error ?? null,
      },
    });
  } catch {
    // Silently swallow — audit logging must never break the chat flow
  }
}

/**
 * Query tool call logs for analytics.
 */
export async function getToolCallStats(
  userId: number,
  days = 30,
): Promise<{
  totalCalls: number;
  byTool: Array<{
    toolName: string;
    count: number;
    successRate: number;
    avgDurationMs: number;
  }>;
  errorRate: number;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let rows: Array<{
    toolName: string;
    _count: { id: number };
    _avg: { durationMs: number | null };
  }> = [];
  let totalCalls = 0;
  let failedCalls = 0;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [grouped, total, failed] = await Promise.all([
      (prisma as any).toolCallLog.groupBy({
        by: ['toolName'],
        where: { userId, createdAt: { gte: since } },
        _count: { id: true },
        _avg: { durationMs: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      (prisma as any).toolCallLog.count({
        where: { userId, createdAt: { gte: since } },
      }),
      (prisma as any).toolCallLog.count({
        where: { userId, createdAt: { gte: since }, success: false },
      }),
    ]);
    rows = grouped;
    totalCalls = total;
    failedCalls = failed;
  } catch {
    // Table may not exist yet (pre-migration) — return empty stats
    return { totalCalls: 0, byTool: [], errorRate: 0 };
  }

  return {
    totalCalls,
    byTool: rows.map((r) => ({
      toolName: r.toolName,
      count: r._count.id,
      successRate:
        r._count.id > 0
          ? Math.round(((r._count.id - failedCalls) / r._count.id) * 100)
          : 100,
      avgDurationMs: Math.round(r._avg.durationMs ?? 0),
    })),
    errorRate:
      totalCalls > 0 ? Math.round((failedCalls / totalCalls) * 100) : 0,
  };
}

/**
 * Get recent tool calls for a user (useful for debugging / admin).
 */
export async function getRecentToolCalls(
  userId: number,
  limit = 20,
): Promise<
  Array<{
    id: number;
    toolName: string;
    args: Record<string, unknown>;
    success: boolean;
    durationMs: number | null;
    error: string | null;
    createdAt: Date;
  }>
> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (prisma as any).toolCallLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        toolName: true,
        args: true,
        success: true,
        durationMs: true,
        error: true,
        createdAt: true,
      },
    });
  } catch {
    return [];
  }
}
