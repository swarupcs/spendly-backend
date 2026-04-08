import { prisma } from '../config/db';
import type { Category } from '../generated/prisma';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpendingAnomaly {
  category: Category;
  currentSpend: number;
  historicalAvg: number;
  percentageIncrease: number;
  severity: 'HIGH' | 'MEDIUM';
}

export interface MonthForecast {
  month: string;
  daysElapsed: number;
  daysRemaining: number;
  daysInMonth: number;
  spentSoFar: number;
  dailyAverage: number;
  projectedTotal: number;
  projectedRemaining: number;
  lastMonthTotal: number;
  vsLastMonthPct: number | null;
  totalBudget: number;
  projectedVsBudgetPct: number | null;
}

export interface PeriodComparison {
  period1: {
    from: string;
    to: string;
    total: number;
    count: number;
    byCategory: Record<string, number>;
  };
  period2: {
    from: string;
    to: string;
    total: number;
    count: number;
    byCategory: Record<string, number>;
  };
  totalDiff: number;
  totalPctChange: number | null;
  direction: 'increased' | 'decreased' | 'unchanged';
  categoryBreakdown: Array<{
    category: string;
    period1: number;
    period2: number;
    diff: number;
    pctChange: number | null;
  }>;
}

export interface BudgetRecommendation {
  category: string;
  averageSpend: number;
  maxSpend: number;
  recommendedBudget: number;
  currentBudget: number | null;
  action: 'SET_NEW' | 'INCREASE' | 'DECREASE' | 'MAINTAIN';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${yearMonth}-01`,
    to: `${yearMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

async function getCategorySpendForMonth(
  userId: number,
  yearMonth: string,
): Promise<Record<string, number>> {
  const { from, to } = monthRange(yearMonth);
  const rows = await prisma.expense.findMany({
    where: { userId, date: { gte: from, lte: to } },
    select: { category: true, convertedAmount: true },
  });
  const result: Record<string, number> = {};
  for (const r of rows) {
    result[r.category] = (result[r.category] ?? 0) + r.convertedAmount;
  }
  return result;
}

function getPreviousMonths(n: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    );
  }
  return result;
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

export async function detectSpendingAnomalies(
  userId: number,
): Promise<SpendingAnomaly[]> {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const historicalMonths = getPreviousMonths(3);

  const [currentSpend, ...historicalSpendsArr] = await Promise.all([
    getCategorySpendForMonth(userId, currentMonth),
    ...historicalMonths.map((m) => getCategorySpendForMonth(userId, m)),
  ]);

  const allCategories = new Set([
    ...Object.keys(currentSpend),
    ...historicalSpendsArr.flatMap((h) => Object.keys(h)),
  ]);

  const anomalies: SpendingAnomaly[] = [];

  for (const cat of allCategories) {
    const historicalValues = historicalSpendsArr
      .map((h) => h[cat] ?? 0)
      .filter((v) => v > 0);

    if (historicalValues.length === 0) continue;

    const avg =
      historicalValues.reduce((s, v) => s + v, 0) / historicalValues.length;
    const currentVal = currentSpend[cat] ?? 0;

    if (avg > 0 && currentVal > avg) {
      const pctIncrease = Math.round(((currentVal - avg) / avg) * 100);
      if (pctIncrease >= 30) {
        anomalies.push({
          category: cat as Category,
          currentSpend: Math.round(currentVal * 100) / 100,
          historicalAvg: Math.round(avg * 100) / 100,
          percentageIncrease: pctIncrease,
          severity: pctIncrease >= 70 ? 'HIGH' : 'MEDIUM',
        });
      }
    }
  }

  return anomalies.sort((a, b) => b.percentageIncrease - a.percentageIncrease);
}

// ─── Month-End Forecast ───────────────────────────────────────────────────────

export async function getMonthForecast(
  userId: number,
  yearMonth?: string,
): Promise<MonthForecast> {
  const now = new Date();
  const targetMonth =
    yearMonth ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, mon] = targetMonth.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const dayOfMonth = now.getDate();
  const remainingDays = daysInMonth - dayOfMonth;

  const todayStr = now.toISOString().split('T')[0];
  const from = `${targetMonth}-01`;
  const to = `${targetMonth}-${daysInMonth}`;

  const [expAgg, budgets] = await Promise.all([
    prisma.expense.aggregate({
      where: {
        userId,
        date: { gte: from, lte: todayStr < to ? todayStr : to },
      },
      _sum: { convertedAmount: true },
    }),
    prisma.budget.findMany({ where: { userId } }),
  ]);

  const spentSoFar = expAgg._sum.convertedAmount ?? 0;
  const dailyAvg = dayOfMonth > 0 ? spentSoFar / dayOfMonth : 0;
  const projectedTotal = Math.round(dailyAvg * daysInMonth * 100) / 100;
  const projectedRemaining = Math.round(dailyAvg * remainingDays * 100) / 100;

  // Last month comparison
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
  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);

  return {
    month: targetMonth,
    daysElapsed: dayOfMonth,
    daysRemaining: remainingDays,
    daysInMonth,
    spentSoFar: Math.round(spentSoFar * 100) / 100,
    dailyAverage: Math.round(dailyAvg * 100) / 100,
    projectedTotal,
    projectedRemaining,
    lastMonthTotal: Math.round(lastMonthTotal * 100) / 100,
    vsLastMonthPct:
      lastMonthTotal > 0
        ? Math.round(((projectedTotal - lastMonthTotal) / lastMonthTotal) * 100)
        : null,
    totalBudget: Math.round(totalBudget * 100) / 100,
    projectedVsBudgetPct:
      totalBudget > 0
        ? Math.round(((projectedTotal - totalBudget) / totalBudget) * 100)
        : null,
  };
}

// ─── Period Comparison ────────────────────────────────────────────────────────

export async function comparePeriods(
  userId: number,
  p1From: string,
  p1To: string,
  p2From: string,
  p2To: string,
): Promise<PeriodComparison> {
  const [e1, e2] = await Promise.all([
    prisma.expense.findMany({
      where: { userId, date: { gte: p1From, lte: p1To } },
      select: { category: true, convertedAmount: true },
    }),
    prisma.expense.findMany({
      where: { userId, date: { gte: p2From, lte: p2To } },
      select: { category: true, convertedAmount: true },
    }),
  ]);

  const agg = (rows: typeof e1) => {
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

  const a1 = agg(e1);
  const a2 = agg(e2);

  const allCategories = new Set([
    ...Object.keys(a1.byCategory),
    ...Object.keys(a2.byCategory),
  ]);
  const categoryBreakdown = Array.from(allCategories)
    .map((cat) => {
      const v1 = Math.round((a1.byCategory[cat] ?? 0) * 100) / 100;
      const v2 = Math.round((a2.byCategory[cat] ?? 0) * 100) / 100;
      const diff = Math.round((v2 - v1) * 100) / 100;
      const pctChange = v1 > 0 ? Math.round((diff / v1) * 100) : null;
      return { category: cat, period1: v1, period2: v2, diff, pctChange };
    })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const totalDiff = Math.round((a2.total - a1.total) * 100) / 100;
  const totalPctChange =
    a1.total > 0 ? Math.round((totalDiff / a1.total) * 100) : null;

  return {
    period1: { from: p1From, to: p1To, ...a1 },
    period2: { from: p2From, to: p2To, ...a2 },
    totalDiff,
    totalPctChange,
    direction:
      totalDiff > 0 ? 'increased' : totalDiff < 0 ? 'decreased' : 'unchanged',
    categoryBreakdown,
  };
}

// ─── Budget Recommendations ───────────────────────────────────────────────────

export async function generateBudgetRecommendations(
  userId: number,
): Promise<BudgetRecommendation[]> {
  const historicalMonths = getPreviousMonths(3);

  const allSpend: Record<string, number[]> = {};
  for (const m of historicalMonths) {
    const spend = await getCategorySpendForMonth(userId, m);
    for (const [cat, amt] of Object.entries(spend)) {
      if (!allSpend[cat]) allSpend[cat] = [];
      allSpend[cat].push(amt);
    }
  }

  const existingBudgets = await prisma.budget.findMany({ where: { userId } });
  const budgetMap: Record<string, number> = {};
  for (const b of existingBudgets) budgetMap[b.category] = b.amount;

  const recommendations: BudgetRecommendation[] = Object.entries(allSpend).map(
    ([cat, values]) => {
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      const max = Math.max(...values);
      const recommended =
        Math.round(Math.min(avg * 1.1, max * 1.05) * 100) / 100;
      const current = budgetMap[cat] ?? null;

      let action: BudgetRecommendation['action'];
      if (current === null) action = 'SET_NEW';
      else if (current < avg) action = 'INCREASE';
      else if (current > recommended * 1.5) action = 'DECREASE';
      else action = 'MAINTAIN';

      return {
        category: cat,
        averageSpend: Math.round(avg * 100) / 100,
        maxSpend: Math.round(max * 100) / 100,
        recommendedBudget: recommended,
        currentBudget: current,
        action,
      };
    },
  );

  return recommendations.sort((a, b) => b.averageSpend - a.averageSpend);
}

// ─── Spending Pattern Analysis ────────────────────────────────────────────────

export interface SpendingPattern {
  topSpendingDayOfWeek: string;
  topSpendingWeekOfMonth: number;
  averageDailySpend: number;
  highSpendDays: Array<{ date: string; amount: number }>;
  categoryTrends: Array<{
    category: string;
    trend: 'INCREASING' | 'DECREASING' | 'STABLE';
    trendPct: number;
  }>;
}

export async function analyzeSpendingPatterns(
  userId: number,
): Promise<SpendingPattern> {
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const from = threeMonthsAgo.toISOString().split('T')[0];
  const to = now.toISOString().split('T')[0];

  const expenses = await prisma.expense.findMany({
    where: { userId, date: { gte: from, lte: to } },
    select: { date: true, convertedAmount: true, category: true },
    orderBy: { date: 'asc' },
  });

  if (expenses.length === 0) {
    return {
      topSpendingDayOfWeek: 'N/A',
      topSpendingWeekOfMonth: 0,
      averageDailySpend: 0,
      highSpendDays: [],
      categoryTrends: [],
    };
  }

  // Day-of-week analysis
  const byDow: Record<number, number> = {};
  for (const e of expenses) {
    const dow = new Date(e.date).getDay();
    byDow[dow] = (byDow[dow] ?? 0) + e.convertedAmount;
  }
  const days = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const topDow = Object.entries(byDow).sort(([, a], [, b]) => b - a)[0];
  const topSpendingDayOfWeek = topDow ? days[parseInt(topDow[0])] : 'N/A';

  // Week-of-month analysis
  const byWom: Record<number, number> = {};
  for (const e of expenses) {
    const dom = new Date(e.date).getDate();
    const wom = Math.ceil(dom / 7);
    byWom[wom] = (byWom[wom] ?? 0) + e.convertedAmount;
  }
  const topWom = Object.entries(byWom).sort(([, a], [, b]) => b - a)[0];
  const topSpendingWeekOfMonth = topWom ? parseInt(topWom[0]) : 0;

  // Daily spend
  const byDate: Record<string, number> = {};
  for (const e of expenses) {
    byDate[e.date] = (byDate[e.date] ?? 0) + e.convertedAmount;
  }
  const uniqueDays = Object.keys(byDate).length;
  const totalSpend = expenses.reduce((s, e) => s + e.convertedAmount, 0);
  const averageDailySpend =
    uniqueDays > 0 ? Math.round((totalSpend / uniqueDays) * 100) / 100 : 0;

  // High-spend days (> 2x average)
  const highSpendDays = Object.entries(byDate)
    .filter(([, amt]) => amt > averageDailySpend * 2)
    .map(([date, amount]) => ({ date, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Category trends (compare first half vs second half of the period)
  const midDate = new Date(
    threeMonthsAgo.getTime() + (now.getTime() - threeMonthsAgo.getTime()) / 2,
  )
    .toISOString()
    .split('T')[0];

  const firstHalf: Record<string, number> = {};
  const secondHalf: Record<string, number> = {};
  for (const e of expenses) {
    if (e.date <= midDate) {
      firstHalf[e.category] = (firstHalf[e.category] ?? 0) + e.convertedAmount;
    } else {
      secondHalf[e.category] =
        (secondHalf[e.category] ?? 0) + e.convertedAmount;
    }
  }

  const allCategories = new Set([
    ...Object.keys(firstHalf),
    ...Object.keys(secondHalf),
  ]);
  const categoryTrends = Array.from(allCategories)
    .map((cat) => {
      const f = firstHalf[cat] ?? 0;
      const s = secondHalf[cat] ?? 0;
      const pct = f > 0 ? Math.round(((s - f) / f) * 100) : 0;
      const trend: 'INCREASING' | 'DECREASING' | 'STABLE' =
        pct >= 15 ? 'INCREASING' : pct <= -15 ? 'DECREASING' : 'STABLE';
      return { category: cat, trend, trendPct: pct };
    })
    .filter((t) => t.trend !== 'STABLE')
    .sort((a, b) => Math.abs(b.trendPct) - Math.abs(a.trendPct));

  return {
    topSpendingDayOfWeek,
    topSpendingWeekOfMonth,
    averageDailySpend,
    highSpendDays,
    categoryTrends,
  };
}

// ─── Financial Health Score ───────────────────────────────────────────────────

export interface FinancialHealthScore {
  score: number; // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: Array<{
    metric: string;
    score: number;
    maxScore: number;
    description: string;
  }>;
  recommendations: string[];
}

export async function computeFinancialHealthScore(
  userId: number,
): Promise<FinancialHealthScore> {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { from, to } = monthRange(currentMonth);
  const todayStr = now.toISOString().split('T')[0];

  const [budgets, goals, anomalies, expenses, settings] = await Promise.all([
    prisma.budget.findMany({ where: { userId } }),
    prisma.financialGoal.findMany({ where: { userId } }),
    detectSpendingAnomalies(userId),
    prisma.expense.aggregate({
      where: {
        userId,
        date: { gte: from, lte: todayStr < to ? todayStr : to },
      },
      _sum: { convertedAmount: true },
    }),
    prisma.userSettings.findUnique({ where: { userId } }),
  ]);

  const breakdown: FinancialHealthScore['breakdown'] = [];
  const recommendations: string[] = [];

  // 1. Budget adherence (25 pts)
  let budgetScore = 0;
  if (budgets.length === 0) {
    budgetScore = 10;
    recommendations.push(
      'Set monthly budgets for your spending categories to track your finances better.',
    );
  } else {
    const monthlySpend = expenses._sum.convertedAmount ?? 0;
    const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
    const utilization = totalBudget > 0 ? monthlySpend / totalBudget : 1;
    budgetScore =
      utilization <= 0.7
        ? 25
        : utilization <= 0.9
          ? 20
          : utilization <= 1
            ? 15
            : 5;
    if (utilization > 0.9)
      recommendations.push(
        "You're close to or over your budget. Review your spending in high categories.",
      );
  }
  breakdown.push({
    metric: 'Budget Adherence',
    score: budgetScore,
    maxScore: 25,
    description: 'How well you stay within your budgets',
  });

  // 2. Goals progress (25 pts)
  let goalsScore = 0;
  if (goals.length === 0) {
    goalsScore = 10;
    recommendations.push(
      'Set financial goals (savings targets or spending limits) to stay motivated.',
    );
  } else {
    const activeGoals = goals.filter((g) => !g.isCompleted);
    const completedGoals = goals.filter((g) => g.isCompleted);
    goalsScore = Math.min(
      25,
      completedGoals.length * 5 + Math.min(activeGoals.length * 3, 10),
    );
  }
  breakdown.push({
    metric: 'Goals Progress',
    score: goalsScore,
    maxScore: 25,
    description: 'Active and completed financial goals',
  });

  // 3. No anomalies (25 pts)
  const highAnomalies = anomalies.filter((a) => a.severity === 'HIGH').length;
  const mediumAnomalies = anomalies.filter(
    (a) => a.severity === 'MEDIUM',
  ).length;
  const anomalyScore = Math.max(
    0,
    25 - highAnomalies * 10 - mediumAnomalies * 5,
  );
  if (anomalies.length > 0) {
    const topAnomaly = anomalies[0];
    recommendations.push(
      `Your ${topAnomaly.category} spending is ${topAnomaly.percentageIncrease}% above average. Consider reviewing these expenses.`,
    );
  }
  breakdown.push({
    metric: 'Spending Consistency',
    score: anomalyScore,
    maxScore: 25,
    description: 'Absence of unusual spending spikes',
  });

  // 4. Tracking consistency (25 pts)
  const daysElapsed = now.getDate();
  const expenseCount = await prisma.expense.count({
    where: { userId, date: { gte: from, lte: todayStr } },
  });
  const trackingRate = daysElapsed > 0 ? expenseCount / daysElapsed : 0;
  const trackingScore =
    trackingRate >= 0.5
      ? 25
      : trackingRate >= 0.3
        ? 20
        : trackingRate >= 0.1
          ? 10
          : 5;
  if (trackingRate < 0.3)
    recommendations.push(
      'Try to log expenses daily for better financial awareness.',
    );
  breakdown.push({
    metric: 'Tracking Consistency',
    score: trackingScore,
    maxScore: 25,
    description: 'How regularly you log your expenses',
  });

  const totalScore = breakdown.reduce((s, b) => s + b.score, 0);
  const grade =
    totalScore >= 85
      ? 'A'
      : totalScore >= 70
        ? 'B'
        : totalScore >= 55
          ? 'C'
          : totalScore >= 40
            ? 'D'
            : 'F';

  return { score: totalScore, grade, breakdown, recommendations };
}

// ─── AI-Narrative Weekly Insight ──────────────────────────────────────────────

export interface WeeklyInsightData {
  fromDate: string;
  toDate: string;
  total: number;
  count: number;
  currency: string;
  topCategory: string | null;
  topCategoryAmount: number;
  vsLastWeekPct: number | null;
  anomalies: SpendingAnomaly[];
  budgetWarnings: Array<{ category: string; percentage: number }>;
  byCategory: Array<{ category: string; amount: number; count: number }>;
}

export async function buildWeeklyInsightData(
  userId: number,
): Promise<WeeklyInsightData> {
  const now = new Date();
  const day = now.getDay() || 7;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - day + 1);
  thisMonday.setHours(0, 0, 0, 0);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const fromDate = fmt(thisMonday);
  const toDate = fmt(now);
  const lastFrom = fmt(lastMonday);
  const lastTo = fmt(new Date(lastMonday.getTime() + 6 * 24 * 60 * 60 * 1000));

  const [thisWeek, lastWeek, budgetStatus, anomalyList, settings] =
    await Promise.all([
      prisma.expense.groupBy({
        by: ['category'],
        where: { userId, date: { gte: fromDate, lte: toDate } },
        _sum: { convertedAmount: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: { userId, date: { gte: lastFrom, lte: lastTo } },
        _sum: { convertedAmount: true },
      }),
      prisma.budget.findMany({ where: { userId } }),
      detectSpendingAnomalies(userId),
      prisma.userSettings.findUnique({
        where: { userId },
        select: { currency: true },
      }),
    ]);

  const total = thisWeek.reduce((s, r) => s + (r._sum.convertedAmount ?? 0), 0);
  const count = thisWeek.reduce((s, r) => s + r._count, 0);
  const sorted = [...thisWeek].sort(
    (a, b) => (b._sum.convertedAmount ?? 0) - (a._sum.convertedAmount ?? 0),
  );
  const top = sorted[0];

  const lastWeekTotal = lastWeek._sum.convertedAmount ?? 0;
  const vsLastWeekPct =
    lastWeekTotal > 0
      ? Math.round(((total - lastWeekTotal) / lastWeekTotal) * 100)
      : null;

  // Budget warnings for this month
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { from: mFrom, to: mTo } = monthRange(currentMonth);
  const monthExpenses = await prisma.expense.groupBy({
    by: ['category'],
    where: { userId, date: { gte: mFrom, lte: mTo } },
    _sum: { convertedAmount: true },
  });
  const monthSpendMap: Record<string, number> = {};
  for (const e of monthExpenses)
    monthSpendMap[e.category] = e._sum.convertedAmount ?? 0;

  const budgetWarnings = budgetStatus
    .map((b) => {
      const spent = monthSpendMap[b.category] ?? 0;
      const pct = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
      return { category: b.category, percentage: pct };
    })
    .filter((w) => w.percentage >= 80)
    .sort((a, b) => b.percentage - a.percentage);

  return {
    fromDate,
    toDate,
    total: Math.round(total * 100) / 100,
    count,
    currency: settings?.currency ?? 'INR',
    topCategory: top?.category ?? null,
    topCategoryAmount: Math.round((top?._sum.convertedAmount ?? 0) * 100) / 100,
    vsLastWeekPct,
    anomalies: anomalyList,
    budgetWarnings,
    byCategory: sorted.map((r) => ({
      category: r.category,
      amount: Math.round((r._sum.convertedAmount ?? 0) * 100) / 100,
      count: r._count,
    })),
  };
}
