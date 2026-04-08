import { prisma } from '../config/db';
import {
  sendBudgetAlertEmail,
  sendLargeExpenseAlertEmail,
  sendWeeklyReportEmail,
  sendMonthlySummaryEmail,
} from '../lib/email';
import { env } from '../config/env';
import type { Category } from '../generated/prisma';
import {
  detectSpendingAnomalies,
  buildWeeklyInsightData,
} from './insights.service';

// ─── Helper: ISO week string ──────────────────────────────────────────────────

function getISOWeekString(date: Date): string {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// ─── Try to create AlertLog ───────────────────────────────────────────────────

async function tryCreateAlertLog(
  userId: number,
  type: string,
  ref: string,
): Promise<boolean> {
  try {
    await prisma.alertLog.create({ data: { userId, type, ref } });
    return true;
  } catch {
    return false;
  }
}

// ─── Check and send alerts after expense creation ─────────────────────────────

export async function checkExpenseAlerts(
  userId: number,
  expense: {
    id: number;
    title: string;
    amount: number;
    currency: string;
    convertedAmount: number;
    category: Category;
    date: string;
  },
): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    }),
    prisma.userSettings.findUnique({
      where: { userId },
      select: {
        emailNotifications: true,
        budgetAlerts: true,
        alertThreshold: true,
        currency: true,
      },
    }),
  ]);

  if (!user || !settings || !settings.emailNotifications) return;

  const homeCurrency = settings.currency ?? 'INR';

  // 1. Large expense check
  if (
    settings.alertThreshold != null &&
    expense.convertedAmount >= settings.alertThreshold
  ) {
    const created = await tryCreateAlertLog(
      userId,
      'large_expense',
      expense.id.toString(),
    );
    if (created) {
      await sendLargeExpenseAlertEmail(
        user.email,
        user.name,
        expense.title,
        expense.amount,
        expense.currency,
        expense.convertedAmount,
        homeCurrency,
        expense.category,
        expense.date,
        settings.alertThreshold,
      );
    }
  }

  // 2. Budget alert check
  if (settings.budgetAlerts) {
    const monthPrefix = expense.date.slice(0, 7);
    const monthStart = `${monthPrefix}-01`;
    const [year, month] = monthPrefix.split('-').map(Number);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const budget = await prisma.budget.findUnique({
      where: { userId_category: { userId, category: expense.category } },
    });

    if (budget) {
      const agg = await prisma.expense.aggregate({
        where: {
          userId,
          category: expense.category,
          date: { gte: monthStart, lt: monthEnd },
        },
        _sum: { convertedAmount: true },
      });

      const totalSpent = agg._sum.convertedAmount ?? 0;
      const pct = (totalSpent / budget.amount) * 100;
      const ref = `${monthPrefix}:${expense.category}`;

      if (pct >= 100) {
        const created = await tryCreateAlertLog(userId, 'budget_100', ref);
        if (created) {
          await sendBudgetAlertEmail(
            user.email,
            user.name,
            expense.category,
            totalSpent,
            budget.amount,
            pct,
            homeCurrency,
            true,
          );
        }
      } else if (pct >= 80) {
        const created = await tryCreateAlertLog(userId, 'budget_80', ref);
        if (created) {
          await sendBudgetAlertEmail(
            user.email,
            user.name,
            expense.category,
            totalSpent,
            budget.amount,
            pct,
            homeCurrency,
            false,
          );
        }
      }
    }
  }
}

// ─── Send Weekly Reports ──────────────────────────────────────────────────────

export async function sendWeeklyReports(): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const now = new Date();
  const day = now.getDay() || 7;
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - 7);
  lastMonday.setHours(0, 0, 0, 0);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  lastSunday.setHours(23, 59, 59, 999);

  const fromDate = lastMonday.toISOString().split('T')[0];
  const toDate = lastSunday.toISOString().split('T')[0];
  const weekRef = getISOWeekString(lastMonday);

  const userSettings = await prisma.userSettings.findMany({
    where: { weeklyReport: true, emailNotifications: true },
    select: { userId: true, currency: true },
  });

  for (const us of userSettings) {
    try {
      const existing = await prisma.alertLog.findUnique({
        where: {
          userId_type_ref: { userId: us.userId, type: 'weekly', ref: weekRef },
        },
      });
      if (existing) continue;

      const user = await prisma.user.findUnique({
        where: { id: us.userId },
        select: { email: true, name: true },
      });
      if (!user) continue;

      const [agg, byCategory] = await Promise.all([
        prisma.expense.aggregate({
          where: { userId: us.userId, date: { gte: fromDate, lte: toDate } },
          _sum: { convertedAmount: true },
          _count: true,
        }),
        prisma.expense.groupBy({
          by: ['category'],
          where: { userId: us.userId, date: { gte: fromDate, lte: toDate } },
          _sum: { convertedAmount: true },
          _count: true,
          orderBy: { _sum: { convertedAmount: 'desc' } },
        }),
      ]);

      const total = agg._sum.convertedAmount ?? 0;
      const count = agg._count;
      if (count === 0) continue;

      await sendWeeklyReportEmail(user.email, user.name, {
        fromDate,
        toDate,
        total,
        count,
        currency: us.currency ?? 'INR',
        byCategory: byCategory.map((c) => ({
          category: c.category,
          amount: c._sum.convertedAmount ?? 0,
          count: c._count,
        })),
      });

      await tryCreateAlertLog(us.userId, 'weekly', weekRef);
    } catch (err) {
      console.error(`Weekly report error for user ${us.userId}:`, err);
    }
  }
}

// ─── Send Monthly Summaries ───────────────────────────────────────────────────

export async function sendMonthlySummaries(): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const now = new Date();
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevYear =
    now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const monthRef = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`;
  const monthStart = `${monthRef}-01`;
  const nextMonthNum = prevMonth + 2 > 12 ? 1 : prevMonth + 2;
  const nextMonthYear = prevMonth + 2 > 12 ? prevYear + 1 : prevYear;
  const monthEnd = `${nextMonthYear}-${String(nextMonthNum).padStart(2, '0')}-01`;
  const daysInMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
  const monthLabel = new Date(prevYear, prevMonth, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const userSettings = await prisma.userSettings.findMany({
    where: { emailNotifications: true },
    select: { userId: true, currency: true },
  });

  for (const us of userSettings) {
    try {
      const existing = await prisma.alertLog.findUnique({
        where: {
          userId_type_ref: {
            userId: us.userId,
            type: 'monthly',
            ref: monthRef,
          },
        },
      });
      if (existing) continue;

      const user = await prisma.user.findUnique({
        where: { id: us.userId },
        select: { email: true, name: true },
      });
      if (!user) continue;

      const [agg, byCategory] = await Promise.all([
        prisma.expense.aggregate({
          where: { userId: us.userId, date: { gte: monthStart, lt: monthEnd } },
          _sum: { convertedAmount: true },
          _count: true,
        }),
        prisma.expense.groupBy({
          by: ['category'],
          where: { userId: us.userId, date: { gte: monthStart, lt: monthEnd } },
          _sum: { convertedAmount: true },
          _count: true,
          orderBy: { _sum: { convertedAmount: 'desc' } },
        }),
      ]);

      const total = agg._sum.convertedAmount ?? 0;
      const count = agg._count;
      if (count === 0) continue;

      const dailyAvg = Math.round((total / daysInMonth) * 100) / 100;

      await sendMonthlySummaryEmail(user.email, user.name, {
        monthLabel,
        total,
        count,
        dailyAvg,
        currency: us.currency ?? 'INR',
        byCategory: byCategory.map((c) => ({
          category: c.category,
          amount: c._sum.convertedAmount ?? 0,
          count: c._count,
        })),
      });

      await tryCreateAlertLog(us.userId, 'monthly', monthRef);
    } catch (err) {
      console.error(`Monthly summary error for user ${us.userId}:`, err);
    }
  }
}

// ─── Proactive anomaly notifications ─────────────────────────────────────────
// Called daily — sends email if HIGH severity anomalies detected

export async function sendAnomalyAlerts(): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const userSettings = await prisma.userSettings.findMany({
    where: { emailNotifications: true, budgetAlerts: true },
    select: { userId: true, currency: true },
  });

  for (const us of userSettings) {
    try {
      // Only send once per category per month
      const ref = `anomaly:${currentMonth}`;
      const existing = await prisma.alertLog.findUnique({
        where: { userId_type_ref: { userId: us.userId, type: 'anomaly', ref } },
      });
      if (existing) continue;

      const anomalies = await detectSpendingAnomalies(us.userId);
      const highAnomalies = anomalies.filter((a) => a.severity === 'HIGH');

      if (highAnomalies.length === 0) continue;

      const user = await prisma.user.findUnique({
        where: { id: us.userId },
        select: { email: true, name: true },
      });
      if (!user) continue;

      // Reuse budget alert email for now (could create a dedicated anomaly email)
      for (const anomaly of highAnomalies.slice(0, 3)) {
        await sendBudgetAlertEmail(
          user.email,
          user.name,
          anomaly.category,
          anomaly.currentSpend,
          anomaly.historicalAvg,
          anomaly.percentageIncrease + 100, // pct vs historical
          us.currency ?? 'INR',
          true,
        );
      }

      await tryCreateAlertLog(us.userId, 'anomaly', ref);
    } catch (err) {
      console.error(`Anomaly alert error for user ${us.userId}:`, err);
    }
  }
}

// ─── Goal deadline nudges ─────────────────────────────────────────────────────

export async function sendGoalNudges(): Promise<void> {
  if (!env.RESEND_API_KEY) return;

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in7DaysStr = in7Days.toISOString().split('T')[0];
  const todayStr = now.toISOString().split('T')[0];

  // Find goals with deadlines in the next 7 days that aren't completed
  const goalsApproaching = await prisma.financialGoal.findMany({
    where: {
      isCompleted: false,
      deadline: { gte: todayStr, lte: in7DaysStr },
    },
    include: {
      user: { select: { email: true, name: true } },
    },
  });

  for (const goal of goalsApproaching) {
    try {
      const ref = `goal_nudge:${goal.id}:${in7DaysStr}`;
      const created = await tryCreateAlertLog(goal.userId, 'goal_nudge', ref);
      if (!created) continue;

      const settings = await prisma.userSettings.findUnique({
        where: { userId: goal.userId },
        select: { emailNotifications: true },
      });
      if (!settings?.emailNotifications) continue;

      const daysLeft = Math.ceil(
        (new Date(goal.deadline!).getTime() - now.getTime()) /
          (24 * 60 * 60 * 1000),
      );
      const progress =
        goal.targetAmount > 0
          ? Math.round((goal.currentAmount / goal.targetAmount) * 100)
          : 0;

      // We'll re-use budget alert email structure for the nudge
      await sendBudgetAlertEmail(
        goal.user.email,
        goal.user.name,
        `Goal: ${goal.name} (${daysLeft} days left, ${progress}% complete)`,
        goal.currentAmount,
        goal.targetAmount,
        progress,
        'INR',
        goal.currentAmount < goal.targetAmount,
      );
    } catch (err) {
      console.error(`Goal nudge error for goal ${goal.id}:`, err);
    }
  }
}
