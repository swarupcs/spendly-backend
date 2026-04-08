import { prisma } from '../config/db';
import type { Category } from '../generated/prisma';

// ═══════════════════════════════════════════════════════════════════
// NET WORTH
// ═══════════════════════════════════════════════════════════════════

export interface NetWorthSnapshot {
  assets: number;
  liabilities: number;
  netWorth: number;
  savingsGoalsValue: number;
  totalNetWorth: number;
  breakdown: {
    manualAssets: number;
    manualLiabilities: number;
    goalsCurrentValue: number;
  };
}

export async function getNetWorthSnapshot(
  userId: number,
): Promise<NetWorthSnapshot> {
  const [settings, goals] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId },
      select: {
        // These fields require the schema migration in SCHEMA_ADDITIONS.prisma
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(true as any), // bypass TS until migration is applied
      },
    }),
    prisma.financialGoal.findMany({
      where: { userId, type: 'SAVINGS' },
      select: { currentAmount: true },
    }),
  ]);

  // Safely read new fields (may not exist pre-migration)
  const assets =
    ((settings as Record<string, unknown>)?.['netWorthAssets'] as number) ?? 0;
  const liabilities =
    ((settings as Record<string, unknown>)?.[
      'netWorthLiabilities'
    ] as number) ?? 0;
  const savingsGoalsValue = goals.reduce((s, g) => s + g.currentAmount, 0);

  const netWorth = assets - liabilities;
  const totalNetWorth = netWorth + savingsGoalsValue;

  return {
    assets,
    liabilities,
    netWorth,
    savingsGoalsValue,
    totalNetWorth,
    breakdown: {
      manualAssets: assets,
      manualLiabilities: liabilities,
      goalsCurrentValue: savingsGoalsValue,
    },
  };
}

export async function updateNetWorth(
  userId: number,
  data: {
    netWorthAssets?: number;
    netWorthLiabilities?: number;
    monthlyIncome?: number;
  },
): Promise<NetWorthSnapshot> {
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: data as any,
  });
  return getNetWorthSnapshot(userId);
}

// ═══════════════════════════════════════════════════════════════════
// ZERO-BASED BUDGETING
// ═══════════════════════════════════════════════════════════════════

export interface ZeroBasedBudgetResult {
  monthlyIncome: number;
  allocations: Array<{
    category: Category;
    recommendedAmount: number;
    currentBudget: number | null;
    percentOfIncome: number;
  }>;
  totalAllocated: number;
  unallocated: number;
  method: 'historical' | 'proportional';
}

const DEFAULT_ALLOCATION_PCT: Partial<Record<Category, number>> = {
  DINING: 0.15,
  SHOPPING: 0.12,
  TRANSPORT: 0.1,
  ENTERTAINMENT: 0.08,
  UTILITIES: 0.1,
  HEALTH: 0.08,
  EDUCATION: 0.05,
  OTHER: 0.05,
};

export async function generateZeroBasedBudget(
  userId: number,
  monthlyIncome?: number,
): Promise<ZeroBasedBudgetResult> {
  // Get income from settings if not passed
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const income =
    monthlyIncome ??
    ((settings as Record<string, unknown>)?.['monthlyIncome'] as number) ??
    0;

  if (income <= 0) {
    throw new Error(
      'Monthly income must be set to use zero-based budgeting. Update it in settings or pass monthlyIncome.',
    );
  }

  // Get 3-month historical spend per category
  const now = new Date();
  const months: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    );
  }

  const historicalSpend: Record<string, number[]> = {};
  for (const m of months) {
    const [y, mo] = m.split('-').map(Number);
    const lastDay = new Date(y, mo, 0).getDate();
    const rows = await prisma.expense.groupBy({
      by: ['category'],
      where: { userId, date: { gte: `${m}-01`, lte: `${m}-${lastDay}` } },
      _sum: { convertedAmount: true },
    });
    for (const r of rows) {
      if (!historicalSpend[r.category]) historicalSpend[r.category] = [];
      historicalSpend[r.category].push(r._sum.convertedAmount ?? 0);
    }
  }

  const existingBudgets = await prisma.budget.findMany({ where: { userId } });
  const budgetMap: Record<string, number> = {};
  for (const b of existingBudgets) budgetMap[b.category] = b.amount;

  const categories: Category[] = [
    'DINING',
    'SHOPPING',
    'TRANSPORT',
    'ENTERTAINMENT',
    'UTILITIES',
    'HEALTH',
    'EDUCATION',
    'OTHER',
  ];

  let method: ZeroBasedBudgetResult['method'] = 'proportional';
  let totalHistorical = 0;

  // Check if we have enough historical data (at least 2 months)
  const hasHistory = Object.values(historicalSpend).some((v) => v.length >= 2);

  const rawAllocations: Array<{ category: Category; amount: number }> = [];

  if (hasHistory) {
    method = 'historical';
    // Compute average spend per category
    for (const cat of categories) {
      const vals = historicalSpend[cat] ?? [];
      const avg =
        vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      rawAllocations.push({ category: cat, amount: avg });
      totalHistorical += avg;
    }

    // Scale allocations proportionally to fit 90% of income (leave 10% as savings buffer)
    const targetTotal = income * 0.9;
    if (totalHistorical > 0) {
      for (const a of rawAllocations) {
        a.amount =
          Math.round((a.amount / totalHistorical) * targetTotal * 100) / 100;
      }
    }
  } else {
    // Fall back to default percentage-based allocation
    for (const cat of categories) {
      const pct = DEFAULT_ALLOCATION_PCT[cat] ?? 0.03;
      rawAllocations.push({
        category: cat,
        amount: Math.round(income * pct * 100) / 100,
      });
    }
  }

  const totalAllocated = rawAllocations.reduce((s, a) => s + a.amount, 0);
  const allocations = rawAllocations.map((a) => ({
    category: a.category,
    recommendedAmount: a.amount,
    currentBudget: budgetMap[a.category] ?? null,
    percentOfIncome: income > 0 ? Math.round((a.amount / income) * 100) : 0,
  }));

  return {
    monthlyIncome: income,
    allocations,
    totalAllocated: Math.round(totalAllocated * 100) / 100,
    unallocated: Math.round((income - totalAllocated) * 100) / 100,
    method,
  };
}

/**
 * Apply zero-based budget allocations by upserting all budget rows.
 */
export async function applyZeroBasedBudget(
  userId: number,
  allocations: Array<{ category: Category; amount: number }>,
): Promise<number> {
  let count = 0;
  for (const a of allocations) {
    if (a.amount > 0) {
      await prisma.budget.upsert({
        where: { userId_category: { userId, category: a.category } },
        create: { userId, category: a.category, amount: a.amount },
        update: { amount: a.amount },
      });
      count++;
    }
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════
// TAX SUMMARY
// ═══════════════════════════════════════════════════════════════════

export interface TaxSummary {
  financialYear: string;
  fromDate: string;
  toDate: string;
  totalExpenses: number;
  taxDeductibleTotal: number;
  nonDeductibleTotal: number;
  deductibleByCategory: Array<{
    category: string;
    amount: number;
    count: number;
  }>;
  deductibleExpenses: Array<{
    id: number;
    title: string;
    amount: number;
    category: string;
    date: string;
    merchant: string | null;
    notes: string | null;
  }>;
}

function getIndianFY(date: Date = new Date()): {
  year: string;
  from: string;
  to: string;
} {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed; April = 3
  const fyStart = month >= 3 ? year : year - 1;
  return {
    year: `FY ${fyStart}-${String(fyStart + 1).slice(-2)}`,
    from: `${fyStart}-04-01`,
    to: `${fyStart + 1}-03-31`,
  };
}

export async function getTaxSummary(
  userId: number,
  financialYear?: string, // e.g. "2024" for FY 2024-25
): Promise<TaxSummary> {
  let from: string;
  let to: string;
  let fyLabel: string;

  if (financialYear) {
    const yr = parseInt(financialYear, 10);
    from = `${yr}-04-01`;
    to = `${yr + 1}-03-31`;
    fyLabel = `FY ${yr}-${String(yr + 1).slice(-2)}`;
  } else {
    const fy = getIndianFY();
    from = fy.from;
    to = fy.to;
    fyLabel = fy.year;
  }

  // Get all expenses, filter tax-deductible ones
  // isTaxDeductible requires schema migration — use safe access
  const allExpenses = await prisma.expense.findMany({
    where: { userId, date: { gte: from, lte: to } },
    orderBy: { date: 'desc' },
  });

  const deductible = allExpenses.filter(
    (e) => (e as Record<string, unknown>)['isTaxDeductible'] === true,
  );
  const nonDeductible = allExpenses.filter(
    (e) => (e as Record<string, unknown>)['isTaxDeductible'] !== true,
  );

  const totalExpenses = allExpenses.reduce((s, e) => s + e.convertedAmount, 0);
  const taxDeductibleTotal = deductible.reduce(
    (s, e) => s + e.convertedAmount,
    0,
  );
  const nonDeductibleTotal = nonDeductible.reduce(
    (s, e) => s + e.convertedAmount,
    0,
  );

  // Group deductible by category
  const byCat: Record<string, { amount: number; count: number }> = {};
  for (const e of deductible) {
    if (!byCat[e.category]) byCat[e.category] = { amount: 0, count: 0 };
    byCat[e.category].amount += e.convertedAmount;
    byCat[e.category].count += 1;
  }

  return {
    financialYear: fyLabel,
    fromDate: from,
    toDate: to,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    taxDeductibleTotal: Math.round(taxDeductibleTotal * 100) / 100,
    nonDeductibleTotal: Math.round(nonDeductibleTotal * 100) / 100,
    deductibleByCategory: Object.entries(byCat)
      .map(([category, v]) => ({
        category,
        amount: Math.round(v.amount * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.amount - a.amount),
    deductibleExpenses: deductible.map((e) => ({
      id: e.id,
      title: e.title,
      amount: e.convertedAmount,
      category: e.category,
      date: e.date,
      merchant:
        ((e as Record<string, unknown>)['merchant'] as string | null) ?? null,
      notes: e.notes ?? null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════
// MERCHANT ANALYTICS
// ═══════════════════════════════════════════════════════════════════

export interface MerchantStats {
  merchant: string;
  totalSpent: number;
  visitCount: number;
  avgPerVisit: number;
  lastVisit: string;
  topCategory: string;
}

export async function getTopMerchants(
  userId: number,
  from?: string,
  to?: string,
  limit = 10,
): Promise<MerchantStats[]> {
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = now.toISOString().split('T')[0];

  const expenses = await prisma.expense.findMany({
    where: {
      userId,
      date: { gte: from ?? defaultFrom, lte: to ?? defaultTo },
      // merchant IS NOT NULL — safe access since field may not exist yet
    },
    select: {
      convertedAmount: true,
      category: true,
      date: true,
      // merchant and isTaxDeductible accessed via unsafe cast below
    },
  });

  // Group by merchant
  const merchantMap: Record<
    string,
    {
      total: number;
      count: number;
      lastVisit: string;
      categories: Record<string, number>;
    }
  > = {};

  for (const e of expenses) {
    const merchant = (e as Record<string, unknown>)['merchant'] as
      | string
      | null;
    if (!merchant) continue;

    if (!merchantMap[merchant]) {
      merchantMap[merchant] = {
        total: 0,
        count: 0,
        lastVisit: e.date,
        categories: {},
      };
    }
    merchantMap[merchant].total += e.convertedAmount;
    merchantMap[merchant].count += 1;
    if (e.date > merchantMap[merchant].lastVisit)
      merchantMap[merchant].lastVisit = e.date;
    merchantMap[merchant].categories[e.category] =
      (merchantMap[merchant].categories[e.category] ?? 0) + 1;
  }

  return Object.entries(merchantMap)
    .map(([merchant, stats]) => {
      const topCategory =
        Object.entries(stats.categories).sort(
          ([, a], [, b]) => b - a,
        )[0]?.[0] ?? 'OTHER';
      return {
        merchant,
        totalSpent: Math.round(stats.total * 100) / 100,
        visitCount: stats.count,
        avgPerVisit: Math.round((stats.total / stats.count) * 100) / 100,
        lastVisit: stats.lastVisit,
        topCategory,
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, limit);
}
