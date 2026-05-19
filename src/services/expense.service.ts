// ─────────────────────────────────────────────────────────────────────────────
// EXPENSE SERVICE — src/services/expense.service.ts
// ─────────────────────────────────────────────────────────────────────────────

import type { Prisma, Category } from '../generated/prisma';
import { prisma } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import type {
  CreateExpenseInput,
  UpdateExpenseInput,
  ExpenseFiltersInput,
  BulkDeleteInput,
} from '../lib/schemas';
import type { ExpenseStats, PaginationMeta } from '../types/index';
import { checkExpenseAlerts } from './alert.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExpenseListResult {
  expenses: Awaited<ReturnType<typeof prisma.expense.findMany>>;
  pagination: PaginationMeta;
}

// ─── List Expenses ────────────────────────────────────────────────────────────

export async function listExpensesService(
  userId: number,
  filters: ExpenseFiltersInput,
): Promise<ExpenseListResult> {
  const { from, to, category, search } = filters;

  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;
  const skip = (page - 1) * limit;

  const where: Prisma.ExpenseWhereInput = { userId };

  if (from && to) where.date = { gte: from, lte: to };
  else if (from) where.date = { gte: from };
  else if (to) where.date = { lte: to };
  if (category) where.category = category;
  if (search) where.title = { contains: search, mode: 'insensitive' };

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take: limit,
    }),
    prisma.expense.count({ where }),
  ]);

  return {
    expenses,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

// ─── Get Stats ────────────────────────────────────────────────────────────────

export async function getStatsService(
  userId: number,
  from?: string,
  to?: string,
): Promise<ExpenseStats> {
  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = now.toISOString().split('T')[0];

  const resolvedFrom = from ?? defaultFrom;
  const resolvedTo = to ?? defaultTo;

  const where: Prisma.ExpenseWhereInput = {
    userId,
    date: { gte: resolvedFrom, lte: resolvedTo },
  };

  const [aggregate, byCategory] = await Promise.all([
    prisma.expense.aggregate({
      where,
      _sum: { convertedAmount: true },
      _count: true,
      _avg: { convertedAmount: true },
      _max: { convertedAmount: true },
      _min: { convertedAmount: true },
    }),
    prisma.expense.groupBy({
      by: ['category'],
      where,
      _sum: { convertedAmount: true },
      _count: true,
      orderBy: { _sum: { convertedAmount: 'desc' } },
    }),
  ]);

  return {
    total: aggregate._sum.convertedAmount ?? 0,
    count: aggregate._count,
    average: aggregate._avg.convertedAmount ?? 0,
    max: aggregate._max.convertedAmount ?? 0,
    min: aggregate._min.convertedAmount ?? 0,
    byCategory: byCategory.map((c) => ({
      category: c.category,
      amount: c._sum.convertedAmount ?? 0,
      count: c._count,
    })),
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportExpensesService(
  userId: number,
  filters: { from?: string; to?: string; category?: Category; search?: string },
) {
  const where: Prisma.ExpenseWhereInput = { userId };
  const { from, to, category, search } = filters;

  if (from && to) where.date = { gte: from, lte: to };
  else if (from) where.date = { gte: from };
  else if (to) where.date = { lte: to };
  if (category) where.category = category;
  if (search) where.title = { contains: search, mode: 'insensitive' };

  return prisma.expense.findMany({ where, orderBy: { date: 'desc' } });
}

// ─── Get Single ───────────────────────────────────────────────────────────────

export async function getExpenseByIdService(userId: number, id: number) {
  const expense = await prisma.expense.findFirst({ where: { id, userId } });
  if (!expense) throw new AppError(404, 'Expense not found');
  return expense;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createExpenseService(
  userId: number,
  input: CreateExpenseInput,
) {
  const { title, amount, category, date, notes } = input;
  const currency = input.currency ?? 'INR';
  // FIX: guard against undefined/null exchangeRate — always fall back to 1
  const exchangeRate =
    input.exchangeRate != null && input.exchangeRate > 0
      ? input.exchangeRate
      : 1.0;
  const convertedAmount = Math.round(amount * exchangeRate * 100) / 100;

  const createData: Prisma.ExpenseUncheckedCreateInput = {
    title,
    amount,
    currency,
    exchangeRate,
    convertedAmount,
    category: (category as Category) ?? 'OTHER',
    date: date ?? new Date().toISOString().split('T')[0]!,
    notes,
    userId,
  };

  const inputAny = input as Record<string, unknown>;
  if (inputAny['merchant'] !== undefined) {
    (createData as Record<string, unknown>)['merchant'] = inputAny['merchant'];
  }
  if (inputAny['isTaxDeductible'] !== undefined) {
    (createData as Record<string, unknown>)['isTaxDeductible'] =
      inputAny['isTaxDeductible'];
  }

  const expense = await prisma.expense.create({ data: createData });

  checkExpenseAlerts(userId, {
    id: expense.id,
    title: expense.title,
    amount: expense.amount,
    currency: expense.currency,
    convertedAmount: expense.convertedAmount,
    category: expense.category,
    date: expense.date,
  }).catch((err) => console.error('Alert error:', err));

  // Auto-categorization Phase 2.5: Save Merchant Rule
  if (expense.merchant) {
    try {
      // @ts-ignore
      await prisma.merchantRule.upsert({
        where: {
          userId_merchant: {
            userId,
            merchant: expense.merchant,
          },
        },
        create: {
          userId,
          merchant: expense.merchant,
          title: expense.title,
          category: expense.category,
          hitCount: 1,
        },
        update: {
          category: expense.category,
          hitCount: { increment: 1 },
        },
      });
    } catch (err) {
      console.error('Failed to save merchant rule:', err);
    }
  }

  return expense;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateExpenseService(
  userId: number,
  id: number,
  input: UpdateExpenseInput,
) {
  const existing = await prisma.expense.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError(404, 'Expense not found');

  const { title, amount, category, date, notes } = input;

  const newAmount = amount ?? existing.amount;

  // FIX: guard null DB value AND null input value — always resolve to a positive number
  const existingRate =
    existing.exchangeRate != null && existing.exchangeRate > 0
      ? existing.exchangeRate
      : 1.0;
  const newRate =
    input.exchangeRate != null && input.exchangeRate > 0
      ? input.exchangeRate
      : existingRate;

  const newConvertedAmount = Math.round(newAmount * newRate * 100) / 100;

  const updateData: Prisma.ExpenseUncheckedUpdateInput = {
    ...(title !== undefined && { title }),
    ...(amount !== undefined && { amount }),
    ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.exchangeRate !== undefined && { exchangeRate: newRate }),
    // FIX: always recalculate convertedAmount whenever amount OR exchangeRate changes
    convertedAmount: newConvertedAmount,
    ...(category !== undefined && { category: category as Category }),
    ...(date !== undefined && { date }),
    ...(notes !== undefined && { notes }),
  };

  const inputAny = input as Record<string, unknown>;
  if (inputAny['merchant'] !== undefined) {
    (updateData as Record<string, unknown>)['merchant'] = inputAny['merchant'];
  }
  if (inputAny['isTaxDeductible'] !== undefined) {
    (updateData as Record<string, unknown>)['isTaxDeductible'] =
      inputAny['isTaxDeductible'];
  }

  const updatedExpense = await prisma.expense.update({ where: { id }, data: updateData });

  // Auto-categorization Phase 2.5: Update Merchant Rule
  if (updatedExpense.merchant) {
    try {
      // @ts-ignore
      await prisma.merchantRule.upsert({
        where: {
          userId_merchant: {
            userId,
            merchant: updatedExpense.merchant,
          },
        },
        create: {
          userId,
          merchant: updatedExpense.merchant,
          category: updatedExpense.category,
          hitCount: 1,
        },
        update: {
          category: updatedExpense.category,
          hitCount: { increment: 1 },
        },
      });
    } catch (err) {
      console.error('Failed to update merchant rule:', err);
    }
  }

  return updatedExpense;
}

// ─── Delete One ───────────────────────────────────────────────────────────────

export async function deleteExpenseService(
  userId: number,
  id: number,
): Promise<void> {
  const existing = await prisma.expense.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError(404, 'Expense not found');
  await prisma.expense.delete({ where: { id } });
}

// ─── Bulk Delete ──────────────────────────────────────────────────────────────

export async function bulkDeleteExpensesService(
  userId: number,
  input: BulkDeleteInput,
): Promise<number> {
  const { count } = await prisma.expense.deleteMany({
    where: { id: { in: input.ids }, userId },
  });
  return count;
}
