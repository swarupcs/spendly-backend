import { prisma } from '../config/db';
import { AppError } from '../middleware/errorHandler';
import type { Category, GoalType } from '../generated/prisma';
import type { CreateGoalInput, UpdateGoalInput } from '../lib/schemas';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoalWithProgress {
  id: number;
  name: string;
  type: GoalType;
  targetAmount: number;
  currentAmount: number;
  category: Category | null;
  period: string | null;
  deadline: string | null;
  isCompleted: boolean;
  notes: string | null;
  progress: number; // 0–100
  createdAt: Date;
  updatedAt: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthDateRange(period: string): { from: string; to: string } {
  const [year, mon] = period.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  return {
    from: `${period}-01`,
    to: `${period}-${String(lastDay).padStart(2, '0')}`,
  };
}

// ─── Get Goals ────────────────────────────────────────────────────────────────

export async function getGoalsService(userId: number): Promise<GoalWithProgress[]> {
  const goals = await prisma.financialGoal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  // Gather unique (period, category) combos needed for SPENDING_LIMIT goals
  const spendMap = new Map<string, number>();
  await Promise.all(
    goals
      .filter((g) => g.type === 'SPENDING_LIMIT')
      .map(async (goal) => {
        const period = goal.period ?? currentMonthStr();
        const key = `${period}:${goal.category ?? 'ALL'}`;
        if (spendMap.has(key)) return;
        const { from, to } = monthDateRange(period);
        const where: Parameters<typeof prisma.expense.aggregate>[0]['where'] = {
          userId,
          date: { gte: from, lte: to },
        };
        if (goal.category) where.category = goal.category;
        const agg = await prisma.expense.aggregate({ where, _sum: { convertedAmount: true } });
        spendMap.set(key, Math.round((agg._sum.convertedAmount ?? 0) * 100) / 100);
      }),
  );

  return goals.map((goal) => {
    let currentAmount = goal.currentAmount;

    if (goal.type === 'SPENDING_LIMIT') {
      const period = goal.period ?? currentMonthStr();
      const key = `${period}:${goal.category ?? 'ALL'}`;
      currentAmount = spendMap.get(key) ?? 0;
    }

    const progress =
      goal.targetAmount > 0
        ? Math.min(Math.round((currentAmount / goal.targetAmount) * 100), 100)
        : 0;

    const isCompleted =
      goal.isCompleted ||
      (goal.type === 'SAVINGS' && currentAmount >= goal.targetAmount);

    return {
      id: goal.id,
      name: goal.name,
      type: goal.type,
      targetAmount: goal.targetAmount,
      currentAmount,
      category: goal.category,
      period: goal.period,
      deadline: goal.deadline,
      isCompleted,
      notes: goal.notes,
      progress,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    };
  });
}

// ─── Create Goal ──────────────────────────────────────────────────────────────

export async function createGoalService(userId: number, input: CreateGoalInput) {
  return prisma.financialGoal.create({
    data: {
      userId,
      name: input.name,
      type: input.type,
      targetAmount: input.targetAmount,
      currentAmount: input.currentAmount ?? 0,
      category: input.category ?? null,
      period: input.period ?? null,
      deadline: input.deadline ?? null,
      notes: input.notes ?? null,
    },
  });
}

// ─── Update Goal ──────────────────────────────────────────────────────────────

export async function updateGoalService(
  userId: number,
  goalId: number,
  input: UpdateGoalInput,
) {
  const goal = await prisma.financialGoal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw new AppError(404, 'Goal not found');
  return prisma.financialGoal.update({ where: { id: goalId }, data: input });
}

// ─── Delete Goal ──────────────────────────────────────────────────────────────

export async function deleteGoalService(userId: number, goalId: number) {
  const goal = await prisma.financialGoal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw new AppError(404, 'Goal not found');
  await prisma.financialGoal.delete({ where: { id: goalId } });
}
