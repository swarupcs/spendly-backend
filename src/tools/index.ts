import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { prisma } from '../config/db';
import type { Category } from '../generated/prisma';
import { checkExpenseAlerts } from '../services/alerts.service';

const categoryEnum = z.enum([
  'DINING',
  'SHOPPING',
  'TRANSPORT',
  'ENTERTAINMENT',
  'UTILITIES',
  'HEALTH',
  'EDUCATION',
  'OTHER',
]);

/**
 * Initialises all LangGraph tools scoped to a specific user.
 * Called once per user — results are cached in the agent factory.
 */
export function initTools(userId: number) {
  // ─── add_expense ─────────────────────────────────────────────────────────

  const addExpense = tool(
    async ({ title, amount, category, date, notes }) => {
      const expense = await prisma.expense.create({
        data: {
          title,
          amount,
          convertedAmount: amount, // INR by default
          category: (category as Category) ?? 'OTHER',
          date: date ?? new Date().toISOString().split('T')[0],
          notes,
          userId,
        },
      });

      // Fire budget/alert checks asynchronously — non-fatal
      checkExpenseAlerts(userId, {
        id: expense.id,
        title: expense.title,
        amount: expense.amount,
        currency: expense.currency,
        convertedAmount: expense.convertedAmount,
        category: expense.category,
        date: expense.date,
      }).catch(console.error);

      return JSON.stringify({
        status: 'success',
        message: `Added "${title}" (₹${amount.toLocaleString('en-IN')}) to your expenses.`,
        id: expense.id,
        category: expense.category,
        date: expense.date,
      });
    },
    {
      name: 'add_expense',
      description:
        'Add a new expense. Call this when the user mentions spending or buying something. ' +
        'If category is unclear from context, use the best matching category. ' +
        'Always confirm with the user after adding.',
      schema: z.object({
        title: z.string().describe('Short description of the expense'),
        amount: z.number().positive().describe('Amount spent in INR'),
        category: categoryEnum
          .optional()
          .describe('Expense category — pick the most fitting one'),
        date: z
          .string()
          .optional()
          .describe('Date in YYYY-MM-DD. Defaults to today if not provided.'),
        notes: z.string().optional().describe('Any extra notes'),
      }),
    },
  );

  // ─── update_expense ───────────────────────────────────────────────────────

  const updateExpense = tool(
    async ({ id, title, amount, category, date, notes }) => {
      const existing = await prisma.expense.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        return JSON.stringify({
          status: 'error',
          message: `Expense #${id} not found.`,
        });
      }

      const newAmount = amount ?? existing.amount;
      const newRate = existing.exchangeRate ?? 1;

      const updated = await prisma.expense.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(amount !== undefined && {
            amount,
            convertedAmount: Math.round(newAmount * newRate * 100) / 100,
          }),
          ...(category !== undefined && { category: category as Category }),
          ...(date !== undefined && { date }),
          ...(notes !== undefined && { notes }),
        },
      });

      return JSON.stringify({
        status: 'success',
        message: `Updated expense #${id}: "${updated.title}" — ₹${updated.amount.toLocaleString('en-IN')}.`,
        expense: {
          id: updated.id,
          title: updated.title,
          amount: updated.amount,
          category: updated.category,
          date: updated.date,
        },
      });
    },
    {
      name: 'update_expense',
      description:
        'Update an existing expense by its ID. Use this when the user wants to correct or edit a previously added expense. ' +
        'Only pass fields that need to change.',
      schema: z.object({
        id: z.number().int().positive().describe('The expense ID to update'),
        title: z.string().optional().describe('New title/description'),
        amount: z.number().positive().optional().describe('New amount in INR'),
        category: categoryEnum.optional().describe('New category'),
        date: z.string().optional().describe('New date in YYYY-MM-DD'),
        notes: z.string().optional().describe('New notes'),
      }),
    },
  );

  // ─── get_expenses ─────────────────────────────────────────────────────────

  const getExpenses = tool(
    async ({ from, to, category, limit }) => {
      const rows = await prisma.expense.findMany({
        where: {
          userId,
          date: { gte: from, lte: to },
          ...(category && { category: category as Category }),
        },
        orderBy: { date: 'desc' },
        take: limit ?? 50,
      });

      if (rows.length === 0) {
        return JSON.stringify({
          message: 'No expenses found for this period.',
          data: [],
          summary: { count: 0, total: 0 },
        });
      }

      const total = rows.reduce((sum, r) => sum + r.convertedAmount, 0);
      const byCategory: Record<string, number> = {};
      for (const r of rows) {
        byCategory[r.category] =
          (byCategory[r.category] ?? 0) + r.convertedAmount;
      }

      return JSON.stringify({
        data: rows.map((r) => ({
          id: r.id,
          title: r.title,
          amount: r.amount,
          currency: r.currency,
          convertedAmount: r.convertedAmount,
          category: r.category,
          date: r.date,
          notes: r.notes,
        })),
        summary: {
          count: rows.length,
          total: Math.round(total * 100) / 100,
          byCategory: Object.entries(byCategory)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, amt]) => ({
              category: cat,
              amount: Math.round(amt * 100) / 100,
            })),
        },
      });
    },
    {
      name: 'get_expenses',
      description:
        'Retrieve expenses for a date range. Use this to answer questions about past spending, ' +
        'summaries, or to find an expense ID before updating/deleting.',
      schema: z.object({
        from: z.string().describe('Start date in YYYY-MM-DD format'),
        to: z.string().describe('End date in YYYY-MM-DD format'),
        category: categoryEnum.optional().describe('Optional category filter'),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Max results (default 50)'),
      }),
    },
  );

  // ─── get_budget_status ────────────────────────────────────────────────────

  const getBudgetStatus = tool(
    async ({ month }) => {
      const now = new Date();
      const targetMonth =
        month ??
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [year, mon] = targetMonth.split('-').map(Number);

      const from = `${targetMonth}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      const to = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;

      const [budgets, expenses] = await Promise.all([
        prisma.budget.findMany({ where: { userId } }),
        prisma.expense.findMany({
          where: { userId, date: { gte: from, lte: to } },
          select: { category: true, convertedAmount: true },
        }),
      ]);

      if (budgets.length === 0) {
        return JSON.stringify({
          message:
            'No budgets set. You can set budgets in the Budgets section.',
          budgets: [],
          month: targetMonth,
        });
      }

      const spentByCategory: Record<string, number> = {};
      for (const e of expenses) {
        spentByCategory[e.category] =
          (spentByCategory[e.category] ?? 0) + e.convertedAmount;
      }

      const overview = budgets.map((b) => {
        const spent =
          Math.round((spentByCategory[b.category] ?? 0) * 100) / 100;
        const remaining = Math.round((b.amount - spent) * 100) / 100;
        const pct = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
        return {
          category: b.category,
          limit: b.amount,
          spent,
          remaining,
          percentage: pct,
          status: pct >= 100 ? 'EXCEEDED' : pct >= 80 ? 'WARNING' : 'OK',
        };
      });

      const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
      const totalSpent = overview.reduce((s, b) => s + b.spent, 0);

      return JSON.stringify({
        month: targetMonth,
        overview,
        totals: {
          totalBudget: Math.round(totalBudget * 100) / 100,
          totalSpent: Math.round(totalSpent * 100) / 100,
          totalRemaining: Math.round((totalBudget - totalSpent) * 100) / 100,
          overallPercentage:
            totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
        },
        alerts: overview.filter((b) => b.status !== 'OK'),
      });
    },
    {
      name: 'get_budget_status',
      description:
        'Get the current budget status for all categories for a given month. ' +
        'Use this when user asks about budgets, remaining budget, or budget warnings.',
      schema: z.object({
        month: z
          .string()
          .optional()
          .describe('Month in YYYY-MM format. Defaults to current month.'),
      }),
    },
  );

  // ─── get_recurring_expenses ───────────────────────────────────────────────

  const getRecurringExpenses = tool(
    async () => {
      const recurring = await prisma.recurringExpense.findMany({
        where: { userId },
        orderBy: [{ isActive: 'desc' }, { nextDueDate: 'asc' }],
      });

      if (recurring.length === 0) {
        return JSON.stringify({
          message: 'No recurring expenses set up.',
          data: [],
        });
      }

      const monthlyEquivalent = recurring
        .filter((r) => r.isActive)
        .reduce((sum, r) => {
          const multipliers: Record<string, number> = {
            DAILY: 30,
            WEEKLY: 4.33,
            MONTHLY: 1,
            YEARLY: 1 / 12,
          };
          return sum + r.amount * (multipliers[r.frequency] ?? 1);
        }, 0);

      return JSON.stringify({
        data: recurring.map((r) => ({
          id: r.id,
          title: r.title,
          amount: r.amount,
          category: r.category,
          frequency: r.frequency,
          nextDueDate: r.nextDueDate,
          isActive: r.isActive,
        })),
        summary: {
          total: recurring.length,
          active: recurring.filter((r) => r.isActive).length,
          monthlyEquivalent: Math.round(monthlyEquivalent * 100) / 100,
        },
      });
    },
    {
      name: 'get_recurring_expenses',
      description:
        'Get all recurring expenses (subscriptions, rent, EMIs, etc.) and their monthly cost equivalent. ' +
        'Use when user asks about fixed expenses, subscriptions, or monthly commitments.',
      schema: z.object({}),
    },
  );

  // ─── get_financial_goals ──────────────────────────────────────────────────

  const getFinancialGoals = tool(
    async () => {
      const goals = await prisma.financialGoal.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      if (goals.length === 0) {
        return JSON.stringify({ message: 'No financial goals set.', data: [] });
      }

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const goalsWithProgress = await Promise.all(
        goals.map(async (g) => {
          let currentAmount = g.currentAmount;

          if (g.type === 'SPENDING_LIMIT') {
            const period = g.period ?? currentMonth;
            const [yr, mn] = period.split('-').map(Number);
            const from = `${period}-01`;
            const to = `${period}-${new Date(yr, mn, 0).getDate()}`;
            const where: Parameters<
              typeof prisma.expense.aggregate
            >[0]['where'] = {
              userId,
              date: { gte: from, lte: to },
            };
            if (g.category) where.category = g.category;
            const agg = await prisma.expense.aggregate({
              where,
              _sum: { convertedAmount: true },
            });
            currentAmount =
              Math.round((agg._sum.convertedAmount ?? 0) * 100) / 100;
          }

          const progress =
            g.targetAmount > 0
              ? Math.min(
                  Math.round((currentAmount / g.targetAmount) * 100),
                  100,
                )
              : 0;

          const isOnTrack =
            g.type === 'SAVINGS'
              ? progress >= 50
              : currentAmount <= g.targetAmount;

          return {
            id: g.id,
            name: g.name,
            type: g.type,
            targetAmount: g.targetAmount,
            currentAmount,
            progress,
            isCompleted:
              g.isCompleted ||
              (g.type === 'SAVINGS' && currentAmount >= g.targetAmount),
            isOnTrack,
            deadline: g.deadline,
            period: g.period,
            category: g.category,
            notes: g.notes,
          };
        }),
      );

      return JSON.stringify({
        data: goalsWithProgress,
        summary: {
          total: goals.length,
          completed: goalsWithProgress.filter((g) => g.isCompleted).length,
          onTrack: goalsWithProgress.filter(
            (g) => g.isOnTrack && !g.isCompleted,
          ).length,
          needsAttention: goalsWithProgress.filter(
            (g) => !g.isOnTrack && !g.isCompleted,
          ).length,
        },
      });
    },
    {
      name: 'get_financial_goals',
      description:
        'Get all financial goals (savings targets, spending limits) with progress. ' +
        'Use when user asks about goals, savings, targets, or financial progress.',
      schema: z.object({}),
    },
  );

  // ─── compare_periods ──────────────────────────────────────────────────────

  const comparePeriods = tool(
    async ({
      period1From,
      period1To,
      period2From,
      period2To,
      label1,
      label2,
    }) => {
      const [p1, p2] = await Promise.all([
        prisma.expense.findMany({
          where: { userId, date: { gte: period1From, lte: period1To } },
          select: { category: true, convertedAmount: true },
        }),
        prisma.expense.findMany({
          where: { userId, date: { gte: period2From, lte: period2To } },
          select: { category: true, convertedAmount: true },
        }),
      ]);

      const aggregate = (rows: typeof p1) => {
        const byCategory: Record<string, number> = {};
        let total = 0;
        for (const r of rows) {
          byCategory[r.category] =
            (byCategory[r.category] ?? 0) + r.convertedAmount;
          total += r.convertedAmount;
        }
        return {
          total: Math.round(total * 100) / 100,
          byCategory,
          count: rows.length,
        };
      };

      const a1 = aggregate(p1);
      const a2 = aggregate(p2);

      const allCategories = new Set([
        ...Object.keys(a1.byCategory),
        ...Object.keys(a2.byCategory),
      ]);
      const categoryDiff = Array.from(allCategories)
        .map((cat) => {
          const v1 = Math.round((a1.byCategory[cat] ?? 0) * 100) / 100;
          const v2 = Math.round((a2.byCategory[cat] ?? 0) * 100) / 100;
          const diff = Math.round((v2 - v1) * 100) / 100;
          const pctChange = v1 > 0 ? Math.round((diff / v1) * 100) : null;
          return {
            category: cat,
            [label1 ?? 'period1']: v1,
            [label2 ?? 'period2']: v2,
            diff,
            pctChange,
          };
        })
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

      const totalDiff = Math.round((a2.total - a1.total) * 100) / 100;
      const totalPctChange =
        a1.total > 0 ? Math.round((totalDiff / a1.total) * 100) : null;

      return JSON.stringify({
        [label1 ?? 'period1']: { from: period1From, to: period1To, ...a1 },
        [label2 ?? 'period2']: { from: period2From, to: period2To, ...a2 },
        comparison: {
          totalDiff,
          totalPctChange,
          direction:
            totalDiff > 0
              ? 'increased'
              : totalDiff < 0
                ? 'decreased'
                : 'unchanged',
          categoryBreakdown: categoryDiff,
        },
      });
    },
    {
      name: 'compare_periods',
      description:
        'Compare spending between two date ranges (e.g. this month vs last month, this week vs last week). ' +
        'Returns totals, category breakdown, and percentage changes.',
      schema: z.object({
        period1From: z.string().describe('Period 1 start date YYYY-MM-DD'),
        period1To: z.string().describe('Period 1 end date YYYY-MM-DD'),
        period2From: z.string().describe('Period 2 start date YYYY-MM-DD'),
        period2To: z.string().describe('Period 2 end date YYYY-MM-DD'),
        label1: z
          .string()
          .optional()
          .describe('Label for period 1 (e.g. "last month")'),
        label2: z
          .string()
          .optional()
          .describe('Label for period 2 (e.g. "this month")'),
      }),
    },
  );

  // ─── get_spending_forecast ────────────────────────────────────────────────

  const getSpendingForecast = tool(
    async ({ month }) => {
      const now = new Date();
      const targetMonth =
        month ??
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [year, mon] = targetMonth.split('-').map(Number);

      const from = `${targetMonth}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      const to = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;

      const todayStr = now.toISOString().split('T')[0];
      const dayOfMonth = now.getDate();
      const daysInMonth = lastDay;

      const expenses = await prisma.expense.findMany({
        where: {
          userId,
          date: { gte: from, lte: todayStr < to ? todayStr : to },
        },
        select: { category: true, convertedAmount: true, date: true },
      });

      const spentSoFar = expenses.reduce((s, e) => s + e.convertedAmount, 0);
      const dailyAvg = dayOfMonth > 0 ? spentSoFar / dayOfMonth : 0;
      const projectedTotal = Math.round(dailyAvg * daysInMonth * 100) / 100;
      const remainingDays = daysInMonth - dayOfMonth;
      const projectedRemaining =
        Math.round(dailyAvg * remainingDays * 100) / 100;

      const prevMonthNum = mon === 1 ? 12 : mon - 1;
      const prevYear = mon === 1 ? year - 1 : year;
      const prevMonthStr = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`;
      const prevLastDay = new Date(prevYear, prevMonthNum, 0).getDate();
      const prevAgg = await prisma.expense.aggregate({
        where: {
          userId,
          date: {
            gte: `${prevMonthStr}-01`,
            lte: `${prevMonthStr}-${prevLastDay}`,
          },
        },
        _sum: { convertedAmount: true },
      });
      const lastMonthTotal = prevAgg._sum.convertedAmount ?? 0;

      const budgets = await prisma.budget.findMany({ where: { userId } });
      const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);

      const byCategory = expenses.reduce(
        (acc, e) => {
          acc[e.category] = (acc[e.category] ?? 0) + e.convertedAmount;
          return acc;
        },
        {} as Record<string, number>,
      );

      const projectedByCategory = Object.entries(byCategory).map(
        ([cat, amt]) => ({
          category: cat,
          spentSoFar: Math.round(amt * 100) / 100,
          projected: Math.round((amt / dayOfMonth) * daysInMonth * 100) / 100,
        }),
      );

      return JSON.stringify({
        month: targetMonth,
        daysElapsed: dayOfMonth,
        daysRemaining: remainingDays,
        daysInMonth,
        spentSoFar: Math.round(spentSoFar * 100) / 100,
        dailyAverage: Math.round(dailyAvg * 100) / 100,
        projectedTotal,
        projectedRemaining,
        lastMonthTotal: Math.round(lastMonthTotal * 100) / 100,
        vsLastMonth:
          lastMonthTotal > 0
            ? Math.round(
                ((projectedTotal - lastMonthTotal) / lastMonthTotal) * 100,
              )
            : null,
        totalBudget: Math.round(totalBudget * 100) / 100,
        projectedVsBudget:
          totalBudget > 0
            ? Math.round(((projectedTotal - totalBudget) / totalBudget) * 100)
            : null,
        projectedByCategory,
      });
    },
    {
      name: 'get_spending_forecast',
      description:
        'Project end-of-month spending based on current pace. ' +
        'Use when user asks "how much will I spend this month?", "am I on track?", or wants a forecast.',
      schema: z.object({
        month: z
          .string()
          .optional()
          .describe('Month in YYYY-MM format. Defaults to current month.'),
      }),
    },
  );

  // ─── get_anomalies ────────────────────────────────────────────────────────

  const getAnomalies = tool(
    async () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [year, mon] = currentMonth.split('-').map(Number);

      const months: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const d = new Date(year, mon - 1 - i, 1);
        months.push(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        );
      }

      const getMonthSpend = async (m: string) => {
        const [y, mo] = m.split('-').map(Number);
        const lastDay = new Date(y, mo, 0).getDate();
        const rows = await prisma.expense.findMany({
          where: { userId, date: { gte: `${m}-01`, lte: `${m}-${lastDay}` } },
          select: { category: true, convertedAmount: true },
        });
        const byCategory: Record<string, number> = {};
        for (const r of rows) {
          byCategory[r.category] =
            (byCategory[r.category] ?? 0) + r.convertedAmount;
        }
        return byCategory;
      };

      const [current, ...historical] = await Promise.all([
        getMonthSpend(currentMonth),
        ...months.map(getMonthSpend),
      ]);

      const allCategories = new Set([
        ...Object.keys(current),
        ...historical.flatMap((h) => Object.keys(h)),
      ]);

      const anomalies: Array<{
        category: string;
        currentSpend: number;
        historicalAvg: number;
        percentageIncrease: number;
        severity: 'HIGH' | 'MEDIUM';
      }> = [];

      for (const cat of allCategories) {
        const historicalValues = historical
          .map((h) => h[cat] ?? 0)
          .filter((v) => v > 0);
        if (historicalValues.length === 0) continue;

        const avg =
          historicalValues.reduce((s, v) => s + v, 0) / historicalValues.length;
        const current_val = current[cat] ?? 0;

        if (avg > 0 && current_val > avg) {
          const pctIncrease = Math.round(((current_val - avg) / avg) * 100);
          if (pctIncrease >= 30) {
            anomalies.push({
              category: cat,
              currentSpend: Math.round(current_val * 100) / 100,
              historicalAvg: Math.round(avg * 100) / 100,
              percentageIncrease: pctIncrease,
              severity: pctIncrease >= 70 ? 'HIGH' : 'MEDIUM',
            });
          }
        }
      }

      anomalies.sort((a, b) => b.percentageIncrease - a.percentageIncrease);

      return JSON.stringify({
        month: currentMonth,
        comparedAgainst: months,
        anomalies,
        hasAnomalies: anomalies.length > 0,
        message:
          anomalies.length === 0
            ? 'No spending anomalies detected. Your spending looks normal compared to recent months.'
            : `Found ${anomalies.length} spending anomaly/anomalies that need attention.`,
      });
    },
    {
      name: 'get_anomalies',
      description:
        'Detect unusual spending patterns by comparing current month to the last 3 months. ' +
        'Use when user asks about unusual spending, overspending alerts, or financial health check.',
      schema: z.object({}),
    },
  );

  // ─── get_budget_recommendations ───────────────────────────────────────────

  const getBudgetRecommendations = tool(
    async () => {
      const now = new Date();
      const months: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        );
      }

      const allSpend: Record<string, number[]> = {};

      for (const m of months) {
        const [yr, mn] = m.split('-').map(Number);
        const lastDay = new Date(yr, mn, 0).getDate();
        const rows = await prisma.expense.groupBy({
          by: ['category'],
          where: { userId, date: { gte: `${m}-01`, lte: `${m}-${lastDay}` } },
          _sum: { convertedAmount: true },
        });
        for (const r of rows) {
          if (!allSpend[r.category]) allSpend[r.category] = [];
          allSpend[r.category].push(r._sum.convertedAmount ?? 0);
        }
      }

      const existingBudgets = await prisma.budget.findMany({
        where: { userId },
      });
      const budgetMap: Record<string, number> = {};
      for (const b of existingBudgets) budgetMap[b.category] = b.amount;

      const recommendations = Object.entries(allSpend).map(([cat, values]) => {
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        const max = Math.max(...values);
        const recommended =
          Math.round(Math.min(avg * 1.1, max * 1.05) * 100) / 100;
        const current = budgetMap[cat] ?? null;

        return {
          category: cat,
          averageSpend: Math.round(avg * 100) / 100,
          maxSpend: Math.round(max * 100) / 100,
          recommendedBudget: recommended,
          currentBudget: current,
          action:
            current === null
              ? 'SET_NEW'
              : current < avg
                ? 'INCREASE'
                : current > recommended * 1.5
                  ? 'DECREASE'
                  : 'MAINTAIN',
        };
      });

      recommendations.sort((a, b) => b.averageSpend - a.averageSpend);

      return JSON.stringify({
        basedOnMonths: months,
        recommendations,
        summary: `Based on your last 3 months of spending, here are budget recommendations for ${recommendations.length} categories.`,
      });
    },
    {
      name: 'get_budget_recommendations',
      description:
        'Generate AI-powered budget recommendations based on 3 months of spending history. ' +
        'Use when user asks "what should my budget be?", "recommend a budget", or "help me budget".',
      schema: z.object({}),
    },
  );

  // ─── generate_expense_chart ───────────────────────────────────────────────

  const generateChart = tool(
    async ({ from, to, groupBy }) => {
      const rows = await prisma.expense.findMany({
        where: { userId, date: { gte: from, lte: to } },
        select: {
          date: true,
          amount: true,
          convertedAmount: true,
          category: true,
        },
        orderBy: { date: 'asc' },
      });

      const grouped: Record<string, number> = {};

      for (const row of rows) {
        let key: string;
        const d = new Date(row.date);

        if (groupBy === 'month') {
          key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        } else if (groupBy === 'week') {
          const startOfYear = new Date(d.getFullYear(), 0, 1);
          const week = Math.ceil(
            ((d.getTime() - startOfYear.getTime()) / 86400000 +
              startOfYear.getDay() +
              1) /
              7,
          );
          key = `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
        } else if (groupBy === 'category') {
          key = row.category;
        } else {
          key = row.date;
        }

        grouped[key] = (grouped[key] ?? 0) + row.convertedAmount;
      }

      const data = Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, total]) => ({
          [groupBy]: period,
          amount: Math.round(total * 100) / 100,
        }));

      return JSON.stringify({ type: 'chart', data, labelKey: groupBy });
    },
    {
      name: 'generate_expense_chart',
      description:
        'Generate chart data grouped by date, week, month, or category. ' +
        'Call ONLY when the user explicitly asks for a chart or graph.',
      schema: z.object({
        from: z.string().describe('Start date in YYYY-MM-DD format'),
        to: z.string().describe('End date in YYYY-MM-DD format'),
        groupBy: z
          .enum(['date', 'week', 'month', 'category'])
          .describe('How to group the data'),
      }),
    },
  );

  // ─── delete_expense ───────────────────────────────────────────────────────

  const deleteExpense = tool(
    async ({ id }) => {
      const expense = await prisma.expense.findFirst({ where: { id, userId } });
      if (!expense) {
        return JSON.stringify({
          status: 'error',
          message: `Expense #${id} not found.`,
        });
      }
      await prisma.expense.delete({ where: { id } });
      return JSON.stringify({
        status: 'success',
        message: `Deleted "${expense.title}" (₹${expense.amount.toLocaleString('en-IN')}).`,
      });
    },
    {
      name: 'delete_expense',
      description: 'Delete a specific expense by its numeric ID.',
      schema: z.object({
        id: z.number().int().positive().describe('The expense ID to delete'),
      }),
    },
  );

  // ─── get_financial_summary ────────────────────────────────────────────────

  const getFinancialSummary = tool(
    async () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [year, mon] = currentMonth.split('-').map(Number);
      const lastDay = new Date(year, mon, 0).getDate();
      const from = `${currentMonth}-01`;
      const to = `${currentMonth}-${lastDay}`;

      const todayStr = now.toISOString().split('T')[0];

      const [monthExpenses, budgets, goals, recurring, subscription] =
        await Promise.all([
          prisma.expense.aggregate({
            where: {
              userId,
              date: { gte: from, lte: todayStr < to ? todayStr : to },
            },
            _sum: { convertedAmount: true },
            _count: true,
          }),
          prisma.budget.findMany({ where: { userId } }),
          prisma.financialGoal.findMany({
            where: { userId, isCompleted: false },
          }),
          prisma.recurringExpense.findMany({
            where: { userId, isActive: true },
          }),
          prisma.subscription.findUnique({ where: { userId } }),
        ]);

      const monthlySpend = monthExpenses._sum.convertedAmount ?? 0;
      const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
      const monthlyRecurring = recurring.reduce((sum, r) => {
        const m: Record<string, number> = {
          DAILY: 30,
          WEEKLY: 4.33,
          MONTHLY: 1,
          YEARLY: 1 / 12,
        };
        return sum + r.amount * (m[r.frequency] ?? 1);
      }, 0);

      return JSON.stringify({
        currentMonth,
        spending: {
          thisMonth: Math.round(monthlySpend * 100) / 100,
          transactions: monthExpenses._count,
          dailyAverage:
            now.getDate() > 0
              ? Math.round((monthlySpend / now.getDate()) * 100) / 100
              : 0,
        },
        budget: {
          totalBudget: Math.round(totalBudget * 100) / 100,
          budgetsSet: budgets.length,
          utilizationPct:
            totalBudget > 0
              ? Math.round((monthlySpend / totalBudget) * 100)
              : null,
        },
        goals: {
          active: goals.length,
          savingsGoals: goals.filter((g) => g.type === 'SAVINGS').length,
          spendingLimitGoals: goals.filter((g) => g.type === 'SPENDING_LIMIT')
            .length,
        },
        recurring: {
          active: recurring.length,
          monthlyCommitment: Math.round(monthlyRecurring * 100) / 100,
        },
        plan: subscription?.plan ?? 'FREE',
      });
    },
    {
      name: 'get_financial_summary',
      description:
        "Get a complete financial overview: this month's spending, budget utilization, goals, recurring expenses. " +
        'Use for general "how am I doing?" or "financial overview" questions.',
      schema: z.object({}),
    },
  );

  // ─── reallocate_budget ────────────────────────────────────────────────────

  const reallocateBudget = tool(
    async ({ fromCategory, toCategory, amount }) => {
      const [fromBudget, toBudget] = await Promise.all([
        prisma.budget.findUnique({
          where: {
            userId_category: { userId, category: fromCategory as Category },
          },
        }),
        prisma.budget.findUnique({
          where: {
            userId_category: { userId, category: toCategory as Category },
          },
        }),
      ]);

      if (!fromBudget) {
        return JSON.stringify({
          status: 'error',
          message: `No budget set for ${fromCategory}. Set one first before reallocating.`,
        });
      }

      if (fromBudget.amount < amount) {
        return JSON.stringify({
          status: 'error',
          message: `${fromCategory} budget is ₹${fromBudget.amount.toLocaleString('en-IN')}. Cannot move ₹${amount.toLocaleString('en-IN')} — insufficient budget.`,
        });
      }

      const newFromAmount =
        Math.round((fromBudget.amount - amount) * 100) / 100;
      const newToAmount =
        Math.round(((toBudget?.amount ?? 0) + amount) * 100) / 100;

      await prisma.$transaction([
        prisma.budget.update({
          where: {
            userId_category: { userId, category: fromCategory as Category },
          },
          data: { amount: newFromAmount },
        }),
        prisma.budget.upsert({
          where: {
            userId_category: { userId, category: toCategory as Category },
          },
          create: {
            userId,
            category: toCategory as Category,
            amount: newToAmount,
          },
          update: { amount: newToAmount },
        }),
      ]);

      return JSON.stringify({
        status: 'success',
        message: `Moved ₹${amount.toLocaleString('en-IN')} from ${fromCategory} to ${toCategory}. New balances: ${fromCategory} = ₹${newFromAmount.toLocaleString('en-IN')}, ${toCategory} = ₹${newToAmount.toLocaleString('en-IN')}.`,
        updated: {
          [fromCategory]: newFromAmount,
          [toCategory]: newToAmount,
        },
      });
    },
    {
      name: 'reallocate_budget',
      description:
        'Move budget money from one category to another. Use when user says "move X from shopping to dining" ' +
        'or "reallocate my budget" or "I overspent on dining, take from shopping".',
      schema: z.object({
        fromCategory: categoryEnum.describe('Category to take budget from'),
        toCategory: categoryEnum.describe('Category to add budget to'),
        amount: z.number().positive().describe('Amount in INR to move'),
      }),
    },
  );

  // ─── mark_tax_deductible ──────────────────────────────────────────────────

  const markTaxDeductible = tool(
    async ({ expenseIds, isTaxDeductible }) => {
      const expenses = await prisma.expense.findMany({
        where: { id: { in: expenseIds }, userId },
        select: { id: true, title: true },
      });

      if (expenses.length === 0) {
        return JSON.stringify({
          status: 'error',
          message: 'No matching expenses found.',
        });
      }

      const foundIds = expenses.map((e) => e.id);

      try {
        await prisma.expense.updateMany({
          where: { id: { in: foundIds }, userId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { isTaxDeductible } as any,
        });
      } catch {
        return JSON.stringify({
          status: 'error',
          message:
            'Tax deductible field not available yet. Run the schema migration first.',
        });
      }

      const action = isTaxDeductible
        ? 'marked as tax-deductible'
        : 'unmarked from tax-deductible';
      return JSON.stringify({
        status: 'success',
        message: `${foundIds.length} expense(s) ${action}: ${expenses.map((e) => `"${e.title}"`).join(', ')}.`,
        updatedIds: foundIds,
      });
    },
    {
      name: 'mark_tax_deductible',
      description:
        'Mark one or more expenses as tax-deductible (or unmark them). ' +
        'Use when user says "this is a business expense", "mark as tax deductible", ' +
        'or "this can be claimed". Use get_expenses first to find the expense IDs.',
      schema: z.object({
        expenseIds: z
          .array(z.number().int().positive())
          .min(1)
          .describe('List of expense IDs to update'),
        isTaxDeductible: z
          .boolean()
          .describe('true to mark as deductible, false to unmark'),
      }),
    },
  );

  // ─── set_merchant ─────────────────────────────────────────────────────────

  const setMerchant = tool(
    async ({ expenseId, merchant }) => {
      const expense = await prisma.expense.findFirst({
        where: { id: expenseId, userId },
      });
      if (!expense) {
        return JSON.stringify({
          status: 'error',
          message: `Expense #${expenseId} not found.`,
        });
      }

      try {
        await prisma.expense.update({
          where: { id: expenseId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data: { merchant } as any,
        });
      } catch {
        return JSON.stringify({
          status: 'error',
          message:
            'Merchant field not available yet. Run the schema migration first.',
        });
      }

      return JSON.stringify({
        status: 'success',
        message: `Set merchant "${merchant}" on "${expense.title}".`,
      });
    },
    {
      name: 'set_merchant',
      description:
        'Set or update the merchant name on an expense. ' +
        'Use when user mentions a specific store or vendor (e.g. "that was from Zomato", "at BigBasket").',
      schema: z.object({
        expenseId: z
          .number()
          .int()
          .positive()
          .describe('The expense ID to update'),
        merchant: z.string().min(1).max(100).describe('Merchant / vendor name'),
      }),
    },
  );

  return [
    addExpense,
    updateExpense,
    getExpenses,
    getBudgetStatus,
    getRecurringExpenses,
    getFinancialGoals,
    comparePeriods,
    getSpendingForecast,
    getAnomalies,
    getBudgetRecommendations,
    reallocateBudget,
    markTaxDeductible,
    setMerchant,
    generateChart,
    deleteExpense,
    getFinancialSummary,
  ];
}
