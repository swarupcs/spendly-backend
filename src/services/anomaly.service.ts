import { prisma } from '../config/db';
import type { Category } from '../generated/prisma';

// ─── Constants ────────────────────────────────────────────────────────────────

// A category spend is considered anomalous if it exceeds the 3-month average
// by this multiplier (e.g. 1.5 means >50% spike)
const ANOMALY_MULTIPLIER = 1.5;
// Minimum amount an average must be to trigger an anomaly (prevents small spikes from alerting)
const MIN_AVERAGE_AMOUNT = 500;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AnomalyAlertResult {
  id: number;
  category: Category;
  amount: number;
  expectedAvg: number;
  percentage: number;
  explanation: string | null;
  createdAt: Date;
}

// ─── Services ─────────────────────────────────────────────────────────────────

export async function detectAnomalies(userId?: number) {
  const users = userId
    ? [{ id: userId }]
    : await prisma.user.findMany({ select: { id: true } });

  const now = new Date();
  
  // Calculate date boundaries
  // Last 30 days
  const last30DaysStart = new Date(now);
  last30DaysStart.setDate(now.getDate() - 30);
  const last30Str = last30DaysStart.toISOString().split('T')[0];

  // The 90 days before the last 30 days
  const previous90DaysStart = new Date(last30DaysStart);
  previous90DaysStart.setDate(previous90DaysStart.getDate() - 90);
  const prev90Str = previous90DaysStart.toISOString().split('T')[0];

  const results: any[] = [];

  for (const user of users) {
    const uid = user.id;

    // 1. Get spending by category for the last 30 days
    const recentSpend = await prisma.expense.groupBy({
      by: ['category'],
      where: {
        userId: uid,
        date: { gte: last30Str },
      },
      _sum: { convertedAmount: true },
    });

    // 2. Get spending by category for the 90 days before that
    const previousSpend = await prisma.expense.groupBy({
      by: ['category'],
      where: {
        userId: uid,
        date: { gte: prev90Str, lt: last30Str },
      },
      _sum: { convertedAmount: true },
    });

    // Convert previous 90-day spend to monthly averages (divide by 3)
    const categoryAverages: Record<string, number> = {};
    for (const item of previousSpend) {
      if (item.category && item._sum.convertedAmount) {
        categoryAverages[item.category] = item._sum.convertedAmount / 3;
      }
    }

    // 3. Compare and create alerts
    for (const item of recentSpend) {
      const category = item.category;
      const recentAmount = item._sum.convertedAmount || 0;
      const expectedAvg = categoryAverages[category as string] || 0;

      // Only flag if the average is substantial enough AND the recent amount is an anomaly
      if (expectedAvg > MIN_AVERAGE_AMOUNT && recentAmount > expectedAvg * ANOMALY_MULTIPLIER) {
        const percentage = Math.round(((recentAmount - expectedAvg) / expectedAvg) * 100);
        
        // Check if we already created an alert for this category in the last 30 days
        // to prevent duplicate alerts
        const existingAlert = await prisma.anomalyAlert.findFirst({
          where: {
            userId: uid,
            category,
            createdAt: { gte: last30DaysStart },
          },
        });

        if (!existingAlert) {
          const explanation = `Your ${category} expenses are ${percentage}% higher than your usual average of ${Math.round(expectedAvg)}.`;
          
          const alert = await prisma.anomalyAlert.create({
            data: {
              userId: uid,
              category,
              amount: recentAmount,
              expectedAvg,
              percentage,
              explanation,
            },
          });
          results.push(alert);
        }
      }
    }
  }

  return results;
}

export async function getActiveAnomaliesService(userId: number) {
  // @ts-ignore
  return prisma.anomalyAlert.findMany({
    where: {
      userId,
      isDismissed: false,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

export async function dismissAnomalyService(userId: number, anomalyId: number) {
  // @ts-ignore
  const alert = await prisma.anomalyAlert.findFirst({
    where: { id: anomalyId, userId },
  });

  if (!alert) {
    throw new Error('Anomaly not found');
  }

  // @ts-ignore
  return prisma.anomalyAlert.update({
    where: { id: anomalyId },
    data: { isDismissed: true },
  });
}
