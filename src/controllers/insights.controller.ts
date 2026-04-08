import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index';
import {
  detectSpendingAnomalies,
  getMonthForecast,
  comparePeriods,
  generateBudgetRecommendations,
  analyzeSpendingPatterns,
  computeFinancialHealthScore,
  buildWeeklyInsightData,
} from '../services/insights.service';

// ─── GET /api/insights/anomalies ──────────────────────────────────────────────

export async function getAnomalies(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const anomalies = await detectSpendingAnomalies(userId);
    res.json({
      success: true,
      data: {
        anomalies,
        hasAnomalies: anomalies.length > 0,
        count: anomalies.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/insights/forecast ───────────────────────────────────────────────

export async function getForecast(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { month } = req.query as { month?: string };
    const forecast = await getMonthForecast(userId, month);
    res.json({ success: true, data: forecast });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/insights/compare ───────────────────────────────────────────────

export async function getComparison(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { period1From, period1To, period2From, period2To } = req.body as {
      period1From: string;
      period1To: string;
      period2From: string;
      period2To: string;
    };

    if (!period1From || !period1To || !period2From || !period2To) {
      res.status(400).json({
        success: false,
        error: 'period1From, period1To, period2From, period2To are required',
      });
      return;
    }

    const comparison = await comparePeriods(
      userId,
      period1From,
      period1To,
      period2From,
      period2To,
    );
    res.json({ success: true, data: comparison });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/insights/budget-recommendations ─────────────────────────────────

export async function getBudgetRecommendations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const recommendations = await generateBudgetRecommendations(userId);
    res.json({ success: true, data: recommendations });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/insights/patterns ───────────────────────────────────────────────

export async function getSpendingPatterns(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const patterns = await analyzeSpendingPatterns(userId);
    res.json({ success: true, data: patterns });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/insights/health-score ──────────────────────────────────────────

export async function getHealthScore(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const score = await computeFinancialHealthScore(userId);
    res.json({ success: true, data: score });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/insights/weekly-summary ────────────────────────────────────────

export async function getWeeklySummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const summary = await buildWeeklyInsightData(userId);
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}
