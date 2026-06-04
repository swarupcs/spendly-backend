import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index';
import type {
  CreateExpenseInput,
  UpdateExpenseInput,
  ExpenseFiltersInput,
  BulkDeleteInput,
} from '../lib/schemas';
import {
  listExpensesService,
  getStatsService,
  getExpenseByIdService,
  createExpenseService,
  updateExpenseService,
  deleteExpenseService,
  bulkDeleteExpensesService,
  exportExpensesService,
} from '../services/expense.service';
import { suggestCategoryService } from '../services/categorization.service';
import { prisma } from '../config/db';
import { sendOnDemandExpenseReportEmail } from '../lib/email';

// ─── GET /api/expenses ────────────────────────────────────────────────────────

export async function listExpenses(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { expenses, pagination } = await listExpensesService(
      userId,
      req.query as unknown as ExpenseFiltersInput,
    );
    res.json({ success: true, data: expenses, pagination });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/expenses/stats ──────────────────────────────────────────────────

export async function getStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { from, to } = req.query as { from?: string; to?: string };
    const stats = await getStatsService(userId, from, to);
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/expenses/:id ────────────────────────────────────────────────────

export async function getExpenseById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid expense ID' });
      return;
    }
    const expense = await getExpenseByIdService(userId, id);
    res.json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/expenses ───────────────────────────────────────────────────────

export async function createExpense(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const expense = await createExpenseService(
      userId,
      req.body as CreateExpenseInput,
    );
    res
      .status(201)
      .json({ success: true, message: 'Expense created', data: expense });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/expenses/:id ──────────────────────────────────────────────────

export async function updateExpense(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid expense ID' });
      return;
    }
    const expense = await updateExpenseService(
      userId,
      id,
      req.body as UpdateExpenseInput,
    );
    res.json({ success: true, message: 'Expense updated', data: expense });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/expenses/:id ─────────────────────────────────────────────────

export async function deleteExpense(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid expense ID' });
      return;
    }
    await deleteExpenseService(userId, id);
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/expenses/export ─────────────────────────────────────────────────

export async function exportExpenses(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { from, to, category, search } = req.query as Record<string, string | undefined>;

    const expenses = await exportExpensesService(userId, {
      from,
      to,
      category: category as import('../generated/prisma').Category | undefined,
      search,
    });

    const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const headers = ['Date', 'Title', 'Category', 'Amount (INR)', 'Notes'];
    const rows = expenses.map((e) =>
      [
        e.date,
        escapeCell(e.title),
        e.category,
        e.amount.toFixed(2),
        escapeCell(e.notes ?? ''),
      ].join(','),
    );

    const csv = [headers.join(','), ...rows].join('\n');
    const fromLabel = from ?? '';
    const toLabel = to ?? '';
    const filename = `expenses${fromLabel ? `-${fromLabel}` : ''}${toLabel ? `-${toLabel}` : ''}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // UTF-8 BOM so Excel opens with correct encoding
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/expenses (bulk) ──────────────────────────────────────────────

export async function bulkDeleteExpenses(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const count = await bulkDeleteExpensesService(
      userId,
      req.body as BulkDeleteInput,
    );
    res.json({
      success: true,
      message: `${count} expense(s) deleted`,
      data: { count },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/expenses/suggest-category ──────────────────────────────────────

export async function suggestCategory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { title, merchant } = req.body as { title: string; merchant?: string };
    
    if (!title && !merchant) {
      res.status(400).json({ success: false, error: 'Title or merchant is required' });
      return;
    }

    const suggestion = await suggestCategoryService(userId, { title, merchant });
    res.json({ success: true, data: suggestion });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/expenses/email-report ──────────────────────────────────────────

export async function emailExpenseReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    
    // Get the user's details (email, name, currency)
    const [user, settings] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
      prisma.userSettings.findUnique({ where: { userId }, select: { currency: true } })
    ]);
    
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Default to current month if no dates provided
    const now = new Date();
    const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const { from = defaultFrom, to } = req.body as { from?: string; to?: string };

    const expenses = await exportExpensesService(userId, { from, to });
    
    const total = expenses.reduce((sum, e) => sum + e.convertedAmount, 0);
    const count = expenses.length;
    const currency = settings?.currency ?? 'INR';
    
    await sendOnDemandExpenseReportEmail(user.email, user.name, {
      total,
      count,
      currency,
      expenses: expenses.map(e => ({
        title: e.title,
        amount: e.convertedAmount,
        category: e.category,
        date: e.date,
        merchant: (e as any).merchant // cast to any since merchant might not be strongly typed in the returned expense if it's new
      }))
    });

    res.json({ success: true, message: 'Expense report sent successfully' });
  } catch (err) {
    next(err);
  }
}

