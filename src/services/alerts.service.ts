import { prisma } from '../config/db';
import type { Category } from '../generated/prisma';

interface ExpensePayload {
  id: number;
  title: string;
  amount: number;
  currency: string;
  convertedAmount: number;
  category: string;
  date: string;
}

/**
 * Checks if the user has exceeded or is approaching their budget
 * for the category of the newly added expense, and fires alerts accordingly.
 *
 * Called fire-and-forget from the add_expense tool — errors are non-fatal.
 */
export const checkExpenseAlerts = async (
  userId: number,
  expense: ExpensePayload,
): Promise<void> => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const from = `${month}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;

  // Find budget for this category
  const budget = await prisma.budget.findUnique({
    where: {
      userId_category: {
        userId,
        category: expense.category as Category,
      },
    },
  });

  if (!budget) return;

  // Sum all spending in this category this month
  const agg = await prisma.expense.aggregate({
    where: {
      userId,
      category: expense.category as Category,
      date: { gte: from, lte: to },
    },
    _sum: { convertedAmount: true },
  });

  const totalSpent = agg._sum.convertedAmount ?? 0;
  const pct = budget.amount > 0 ? (totalSpent / budget.amount) * 100 : 0;

  if (pct >= 100) {
    console.warn(
      `[alerts] User ${userId} EXCEEDED ${expense.category} budget: ` +
        `₹${totalSpent.toFixed(2)} / ₹${budget.amount} (${Math.round(pct)}%)`,
    );
    // TODO: send push notification / email / in-app alert
  } else if (pct >= 80) {
    console.warn(
      `[alerts] User ${userId} at ${Math.round(pct)}% of ${expense.category} budget: ` +
        `₹${totalSpent.toFixed(2)} / ₹${budget.amount}`,
    );
    // TODO: send warning notification
  }
};
