import { prisma } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import type { Category } from '../generated/prisma';
import type { UpsertBudgetInput } from '../lib/schemas';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetOverviewItem {
  id: number;
  category: Category;
  limit: number;
  spent: number;
  remaining: number;
  percentage: number;
  isOverBudget: boolean;
}

// ─── Get All Budgets ──────────────────────────────────────────────────────────

export async function getBudgetsService(userId: number) {
  return prisma.budget.findMany({
    where: { userId },
    orderBy: { category: 'asc' },
    select: { id: true, category: true, amount: true, updatedAt: true },
  });
}

// ─── Upsert Budget ────────────────────────────────────────────────────────────

export async function upsertBudgetService(userId: number, input: UpsertBudgetInput) {
  const { category, amount } = input;
  return prisma.budget.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category, amount },
    update: { amount },
    select: { id: true, category: true, amount: true, updatedAt: true },
  });
}

// ─── Delete Budget ────────────────────────────────────────────────────────────

export async function deleteBudgetService(userId: number, budgetId: number) {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, userId } });
  if (!budget) throw new AppError(404, 'Budget not found');
  await prisma.budget.delete({ where: { id: budgetId } });
}

// ─── Budget Overview (with spending) ─────────────────────────────────────────

export async function getBudgetOverviewService(
  userId: number,
  month?: string, // YYYY-MM, defaults to current month
): Promise<BudgetOverviewItem[]> {
  // Resolve month
  const now = new Date();
  const targetMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, mon] = targetMonth.split('-').map(Number);

  const from = `${targetMonth}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const to = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;

  // Load budgets and expenses for the month in parallel
  const [budgets, expenses] = await Promise.all([
    prisma.budget.findMany({
      where: { userId },
      select: { id: true, category: true, amount: true },
    }),
    prisma.expense.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { category: true, convertedAmount: true },
    }),
  ]);

  // Aggregate spending per category (using home-currency converted amounts)
  const spentByCategory: Partial<Record<Category, number>> = {};
  for (const exp of expenses) {
    spentByCategory[exp.category] = (spentByCategory[exp.category] ?? 0) + exp.convertedAmount;
  }

  return budgets.map((b) => {
    const spent = Math.round((spentByCategory[b.category] ?? 0) * 100) / 100;
    const remaining = Math.round((b.amount - spent) * 100) / 100;
    const percentage = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0;
    return {
      id: b.id,
      category: b.category,
      limit: b.amount,
      spent,
      remaining,
      percentage,
      isOverBudget: spent > b.amount,
    };
  });
}
