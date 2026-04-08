import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import {
  MemorySaver,
  MessagesAnnotation,
  StateGraph,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { initTools } from '../tools/index';
import { getLlm } from './llm.factory';
import type { ToolCapableLlm } from './llm.factory';
import type { StreamMessage } from '../types/index';
import { checkPlanLimit } from '../services/billing.service';
import { AppError } from '../middleware/errorHandler';
import { logToolCall } from '../services/toollog.service';

// ─── Shared checkpointer ──────────────────────────────────────────────────────
// For production at scale, replace with a Redis-backed or DB-backed checkpointer.
const checkpointer = new MemorySaver();

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toISOString();
  const dayOfWeek = now.toLocaleDateString('en-IN', { weekday: 'long' });
  const monthName = now.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  // Indian Financial Year: April 1 – March 31
  const currentYear = now.getFullYear();
  const fyStart =
    now.getMonth() >= 3 // April = month 3 (0-indexed)
      ? `${currentYear}-04-01`
      : `${currentYear - 1}-04-01`;
  const fyEnd =
    now.getMonth() >= 3 ? `${currentYear + 1}-03-31` : `${currentYear}-03-31`;

  return [
    'You are Spendly AI — a smart personal finance assistant embedded in an expense tracking app.',
    `Current datetime: ${dateStr} (${dayOfWeek}, ${monthName}).`,
    `Indian Financial Year: ${fyStart} to ${fyEnd}.`,
    '',
    '════════════════════════════════════════',
    'STRICT SCOPE — READ THIS FIRST:',
    '════════════════════════════════════════',
    'You ONLY help with personal finance and expense tracking topics. This includes:',
    '  • Adding, viewing, editing, or deleting expenses',
    '  • Spending summaries, budgets, and financial insights',
    '  • Charts and reports about expenses',
    '  • Financial goals tracking (savings, spending limits)',
    '  • Recurring expenses and subscriptions',
    '  • Spending forecasts and anomaly detection',
    '  • Budget recommendations and financial advice',
    '  • General personal finance advice (saving, budgeting, investing basics)',
    '',
    'If the user asks about ANYTHING outside this scope, respond with EXACTLY:',
    '  "I\'m your expense tracking assistant, so I can only help with personal finance',
    '   and expense-related topics. Try asking me to add an expense, show your',
    '   spending summary, or give you a budget breakdown! 💰"',
    '════════════════════════════════════════',
    '',
    'NATURAL LANGUAGE DATE HANDLING:',
    '  • "today" → use current date',
    '  • "yesterday" → use yesterday\'s date',
    '  • "this week" → Monday to today',
    '  • "last week" → previous Monday to Sunday',
    '  • "this month" → 1st to today',
    '  • "last month" → full previous month',
    '  • "this quarter" → current 3-month period',
    '  • "this financial year" / "this FY" → April 1 to March 31 (Indian FY)',
    '  • "last fortnight" → 14 days ago to today',
    '  • "last 30 days" → 30 days ago to today',
    '',
    'TOOL USAGE GUIDELINES:',
    '  • add_expense: when user mentions spending/buying anything',
    '  • update_expense: when user wants to edit/correct an expense (use get_expenses first to find ID)',
    '  • get_expenses: to answer questions about past spending',
    '  • get_budget_status: when user asks about budgets, budget remaining, budget health',
    '  • get_recurring_expenses: when user asks about subscriptions, fixed costs, EMIs',
    '  • get_financial_goals: when user asks about savings goals or spending limits',
    '  • compare_periods: for "this month vs last month" or any period comparison',
    '  • get_spending_forecast: for "how much will I spend?" or "am I on track?"',
    '  • get_anomalies: for "unusual spending?", "any alerts?", or general financial check',
    '  • get_budget_recommendations: for "suggest my budget" or "help me set a budget"',
    '  • reallocate_budget: for "move X from shopping to dining" or "rebalance my budget"',
    '  • mark_tax_deductible: for "this is a business expense" or "mark as tax deductible"',
    '  • set_merchant: for "that was from Zomato" or when user names a specific store/vendor',
    '  • get_financial_summary: for general "how am I doing?" or overview questions',
    '  • generate_expense_chart: ONLY when user explicitly asks for a chart/graph/visual',
    '  • delete_expense: when user asks to remove a specific expense',
    '',
    'BEHAVIOUR:',
    '  • Use INR (₹) currency unless the user specifies otherwise.',
    '  • Format numbers in Indian style: ₹1,50,000 (not ₹150,000).',
    '  • Be concise, warm, and actionable — not verbose.',
    '  • If category is unclear when adding expense, infer from context or ask once.',
    '  • For multi-expense messages ("spent 200 on food and 500 on uber"), add each separately.',
    '  • After adding an expense, confirm with the total and category.',
    '  • When giving insights, highlight 1-2 actionable takeaways.',
    '  • Never hallucinate data — always call tools to get real data.',
    '  • For "this month vs last month" questions, always use compare_periods tool.',
    '  • When user says "last expense" or "recent expense", use get_expenses to find it first.',
  ].join('\n');
}

// ─── Off-topic reply ──────────────────────────────────────────────────────────

const OFF_TOPIC_REPLY =
  "I'm your expense tracking assistant, so I can only help with personal finance " +
  'and expense-related topics. Try asking me to add an expense, show your spending ' +
  'summary, or give you a budget breakdown! 💰';

// ─── Topic Guard ──────────────────────────────────────────────────────────────

function isRelevantMessage(text: string): boolean {
  const lower = text.toLowerCase().trim();

  const ALLOW_PATTERNS: RegExp[] = [
    /^h(i|ello|ey)\b/,
    /^good\s+(morning|afternoon|evening)/,
    /\bwhat can you (do|help)/,
    /\bhow (do|can) (i|you)/,
    /\bhelp\b/,
    /\bexpense/,
    /\bspend/,
    /\bspent/,
    /\bbought/,
    /\bpurchase/,
    /\bbill/,
    /\binvoice/,
    /\breceipt/,
    /\bbudget/,
    /\bsav(e|ing|ings)/,
    /\bfinance/,
    /\bmoney/,
    /\bcash/,
    /\bpay(ment|ing|ed)?\b/,
    /\bcost/,
    /\bprice/,
    /\bamount/,
    /\btotal/,
    /\bsummar(y|ise|ize)/,
    /\bchart/,
    /\bgraph/,
    /\breport/,
    /\binsight/,
    /\bcategor(y|ies)/,
    /\bdelete\s+(expense|record)/,
    /\bremove\s+(expense|record)/,
    /\bedit\s+(expense|record)/,
    /\bupdate\s+(expense|record)/,
    /\binr\b/,
    /₹/,
    /\brupee/,
    /\bdining/,
    /\bshopping/,
    /\btransport/,
    /\butilities/,
    /\btracking/,
    /\btransaction/,
    /\brecurring/,
    /\bsubscription/,
    /\bemi\b/,
    /\bloan\b/,
    /\bgoal/,
    /\bsaving/,
    /\btarget/,
    /\bforecast/,
    /\bpredict/,
    /\banomaly|anomalies/,
    /\bunusual/,
    /\boverspend/,
    /\bon track/,
    /\bcompare/,
    /\blast month/,
    /\bthis month/,
    /\bthis week/,
    /\blast week/,
    /\bfinancial year/,
    /\bhow am i doing/,
    /\boverview/,
  ];

  if (ALLOW_PATTERNS.some((re) => re.test(lower))) return true;

  const BLOCK_PATTERNS: RegExp[] = [
    /\bwrite (a |an )?(poem|story|essay|code|function|script|email(?! expense)|letter|song|blog)/,
    /\b(recipe|how (to )?cook|bake|ingredient|meal (plan|prep))\b/,
    /\b(weather|forecast|temperature|climate)\b(?!.*spend)(?!.*budget)/,
    /\b(debug|fix (my )?code|coding|programming|javascript|python|typescript|react|nodejs|sql(?! expense)|algorithm)\b/,
    /\b(capital of|president of|who (invented|discovered|wrote)|history of|explain (quantum|relativity|photosynthesis))\b/,
    /\b(movie|film|series|tv show|song|music|lyrics|actor|actress|celebrity|anime)\b/,
    /\b(translate (this|to|into)|in (french|spanish|german|japanese|arabic|chinese|korean))\b/,
    /\b(joke|riddle|fun fact|trivia|play (a\s+)?(game|quiz))\b/,
    /\b(sport|cricket|football|basketball|tennis|ipl|fifa)\b(?!.*expense)(?!.*spend)/,
    /\b(how (does )?bitcoin work|what is ethereum|nft|blockchain)\b(?!.*expense)/,
    /\b(diagnose|symptom|medicine|dosage|workout routine|exercise plan)\b(?!.*expense)/,
    /\b(best (place|destination) to (visit|travel)|tourist spot|visa requirements)\b(?!.*expense)/,
  ];

  if (BLOCK_PATTERNS.some((re) => re.test(lower))) return false;

  return true;
}

// ─── Agent Factory ────────────────────────────────────────────────────────────

export function createAgent(userId: number, threadId?: string) {
  const tools = initTools(userId);
  const llm: ToolCapableLlm = getLlm();

  // Wrap each tool to capture audit logs (duration + success/error)
  const auditedTools = tools.map((t) => {
    const originalInvoke = t.invoke.bind(t);
    t.invoke = async (input: unknown, config?: unknown) => {
      const start = Date.now();
      try {
        const result = await originalInvoke(
          input as Parameters<typeof originalInvoke>[0],
          config as Parameters<typeof originalInvoke>[1],
        );
        logToolCall({
          userId,
          threadId,
          toolName: t.name,
          args: input as Record<string, unknown>,
          result: (() => {
            try {
              return JSON.parse(result as string);
            } catch {
              return { raw: result };
            }
          })(),
          durationMs: Date.now() - start,
          success: true,
        }).catch(() => {});
        return result;
      } catch (err) {
        logToolCall({
          userId,
          threadId,
          toolName: t.name,
          args: input as Record<string, unknown>,
          durationMs: Date.now() - start,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        throw err;
      }
    };
    return t;
  });

  const toolNode = new ToolNode(auditedTools);

  // ── Nodes ─────────────────────────────────────────────────────────────────

  async function callModel(
    state: typeof MessagesAnnotation.State,
    _config: LangGraphRunnableConfig,
  ) {
    const lastUserMessage = [...state.messages]
      .reverse()
      .find((m) => m.getType() === 'human');

    if (lastUserMessage) {
      const text =
        typeof lastUserMessage.content === 'string'
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage.content);

      if (!isRelevantMessage(text)) {
        return { messages: [new AIMessage({ content: OFF_TOPIC_REPLY })] };
      }
    }

    const llmWithTools = llm.bindTools(auditedTools);

    const response = await llmWithTools.invoke([
      { role: 'system', content: buildSystemPrompt() },
      ...state.messages,
    ]);

    return { messages: [response] };
  }

  // ── Edge logic ────────────────────────────────────────────────────────────

  function shouldContinue(
    state: typeof MessagesAnnotation.State,
    config: LangGraphRunnableConfig,
  ): string {
    const lastMessage = state.messages.at(-1) as AIMessage;

    if (lastMessage.tool_calls?.length) {
      // Announce all tool calls, not just the first
      for (const call of lastMessage.tool_calls) {
        const announcement: StreamMessage = {
          type: 'toolCall:start',
          payload: {
            name: call.name,
            args: call.args as Record<string, unknown>,
          },
        };
        config.writer!(announcement);
      }
      return 'tools';
    }

    return '__end__';
  }

  function shouldCallModel(state: typeof MessagesAnnotation.State): string {
    const lastMessage = state.messages.at(-1) as ToolMessage;

    try {
      const parsed = JSON.parse(lastMessage.content as string) as Record<
        string,
        unknown
      >;
      if (parsed['type'] === 'chart') return '__end__';
    } catch {
      // Not JSON → normal tool result
    }

    return 'callModel';
  }

  // ── Graph ─────────────────────────────────────────────────────────────────

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('callModel', callModel)
    .addNode('tools', toolNode)
    .addEdge('__start__', 'callModel')
    .addConditionalEdges('callModel', shouldContinue, {
      tools: 'tools',
      __end__: '__end__',
    })
    .addConditionalEdges('tools', shouldCallModel, {
      callModel: 'callModel',
      __end__: '__end__',
    });

  return graph.compile({ checkpointer });
}

// ─── Agent Cache ──────────────────────────────────────────────────────────────

const agentCache = new Map<number, ReturnType<typeof createAgent>>();

export function getAgent(userId: number): ReturnType<typeof createAgent> {
  if (!agentCache.has(userId)) {
    agentCache.set(userId, createAgent(userId));
  }
  return agentCache.get(userId)!;
}

export function clearAgentCache(): void {
  agentCache.clear();
}

// ─── Plan limit enforcement ───────────────────────────────────────────────────

export async function enforceAiMessageLimit(userId: number): Promise<void> {
  await checkPlanLimit(userId, 'aiMessages');
}
