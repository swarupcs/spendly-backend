import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index';
import {
  getNetWorthSnapshot,
  updateNetWorth,
  generateZeroBasedBudget,
  applyZeroBasedBudget,
  getTaxSummary,
  getTopMerchants,
} from '../services/finance.service';
import {
  getToolCallStats,
  getRecentToolCalls,
} from '../services/toollog.service';
import type { Category } from '../generated/prisma';

// ─── GET /api/finance/net-worth ───────────────────────────────────────────────

export async function getNetWorth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const data = await getNetWorthSnapshot(userId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/finance/net-worth ─────────────────────────────────────────────

export async function updateNetWorthController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { netWorthAssets, netWorthLiabilities, monthlyIncome } = req.body as {
      netWorthAssets?: number;
      netWorthLiabilities?: number;
      monthlyIncome?: number;
    };
    const data = await updateNetWorth(userId, {
      netWorthAssets,
      netWorthLiabilities,
      monthlyIncome,
    });
    res.json({ success: true, data, message: 'Net worth updated.' });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/finance/zero-based-budget ───────────────────────────────────────

export async function getZeroBasedBudget(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const income = req.query.income
      ? parseFloat(req.query.income as string)
      : undefined;
    const data = await generateZeroBasedBudget(userId, income);
    res.json({ success: true, data });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Monthly income must be set')
    ) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    next(err);
  }
}

// ─── POST /api/finance/zero-based-budget/apply ───────────────────────────────

export async function applyZeroBasedBudgetController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { allocations } = req.body as {
      allocations: Array<{ category: Category; amount: number }>;
    };

    if (!Array.isArray(allocations) || allocations.length === 0) {
      res
        .status(400)
        .json({ success: false, error: 'allocations array is required.' });
      return;
    }

    const count = await applyZeroBasedBudget(userId, allocations);
    res.json({
      success: true,
      message: `Applied ${count} budget allocations.`,
      data: { count },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/finance/tax-summary ─────────────────────────────────────────────

export async function getTaxSummaryController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { fy } = req.query as { fy?: string }; // e.g. fy=2024 → FY 2024-25
    const data = await getTaxSummary(userId, fy);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/finance/merchants ───────────────────────────────────────────────

export async function getTopMerchantsController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { from, to, limit } = req.query as {
      from?: string;
      to?: string;
      limit?: string;
    };
    const data = await getTopMerchants(
      userId,
      from,
      to,
      limit ? parseInt(limit, 10) : 10,
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/finance/tool-stats ─────────────────────────────────────────────
// Admin/debug: AI tool usage analytics for the current user

export async function getToolStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    const data = await getToolCallStats(userId, days);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/finance/tool-log ────────────────────────────────────────────────

export async function getToolLog(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 20;
    const data = await getRecentToolCalls(userId, limit);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
