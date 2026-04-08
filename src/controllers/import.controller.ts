import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index';
import {
  parseReceiptImage,
  parseBulkExpenses,
  parseBankStatementCsv,
  bulkCreateFromParsed,
} from '../services/receipt.service';
import { createExpenseService } from '../services/expense.service';
import type { Category } from '../generated/prisma';

// ─── POST /api/import/receipt ─────────────────────────────────────────────────
// Body: { image: base64string, mediaType: "image/jpeg"|"image/png", save?: boolean }

export async function parseReceipt(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const {
      image,
      mediaType,
      save = false,
    } = req.body as {
      image: string;
      mediaType: string;
      save?: boolean;
    };

    if (!image || !mediaType) {
      res
        .status(400)
        .json({
          success: false,
          error: 'image (base64) and mediaType are required.',
        });
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(mediaType)) {
      res
        .status(400)
        .json({
          success: false,
          error: `mediaType must be one of: ${validTypes.join(', ')}`,
        });
      return;
    }

    const parsed = await parseReceiptImage(image, mediaType, userId);

    // If save=true, immediately create the expense
    let createdExpenseId: number | null = null;
    if (save) {
      const expense = await createExpenseService(userId, {
        title: parsed.title,
        amount: parsed.amount,
        currency: parsed.currency,
        category: parsed.category,
        date: parsed.date,
        notes: parsed.notes,
      });
      createdExpenseId = expense.id;
    }

    res.json({
      success: true,
      data: {
        parsed,
        saved: save,
        expenseId: createdExpenseId,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/import/bulk-text ───────────────────────────────────────────────
// Body: { text: string, save?: boolean }
// e.g. "spent 200 on food, 500 on uber, 150 on chai"

export async function parseBulkText(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { text, save = false } = req.body as { text: string; save?: boolean };

    if (!text || text.trim().length === 0) {
      res.status(400).json({ success: false, error: 'text is required.' });
      return;
    }

    const result = await parseBulkExpenses(text);

    let savedCount = 0;
    if (save && result.expenses.length > 0) {
      savedCount = await bulkCreateFromParsed(userId, result.expenses);
    }

    res.json({
      success: true,
      data: {
        ...result,
        saved: save,
        savedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/import/csv ─────────────────────────────────────────────────────
// Body: { csv: string (CSV content), save?: boolean, dryRun?: boolean }

export async function importCsv(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const {
      csv,
      save = false,
      dryRun = true,
    } = req.body as {
      csv: string;
      save?: boolean;
      dryRun?: boolean;
    };

    if (!csv || csv.trim().length === 0) {
      res
        .status(400)
        .json({ success: false, error: 'csv content is required.' });
      return;
    }

    const result = await parseBankStatementCsv(csv, userId);

    let savedCount = 0;
    if (save && !dryRun && result.rows.length > 0) {
      savedCount = await bulkCreateFromParsed(
        userId,
        result.rows.map((r) => ({
          title: r.title,
          amount: r.amount,
          category: r.category as Category,
          date: r.date,
        })),
      );
    }

    res.json({
      success: true,
      data: {
        preview: result.rows.slice(0, 10), // First 10 rows for preview
        totalRows: result.totalRows,
        totalAmount: result.totalAmount,
        errors: result.errors,
        dryRun,
        saved: !dryRun && save,
        savedCount,
        message: dryRun
          ? `Parsed ${result.totalRows} expenses. Review and confirm to save.`
          : `Imported ${savedCount} expenses successfully.`,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/import/csv/confirm ─────────────────────────────────────────────
// Saves all parsed rows after dry-run preview

export async function confirmCsvImport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const { rows } = req.body as {
      rows: Array<{
        title: string;
        amount: number;
        category: Category;
        date?: string;
        notes?: string;
      }>;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      res
        .status(400)
        .json({ success: false, error: 'rows array is required.' });
      return;
    }

    const savedCount = await bulkCreateFromParsed(userId, rows);

    res.json({
      success: true,
      message: `Successfully imported ${savedCount} expenses.`,
      data: { savedCount },
    });
  } catch (err) {
    next(err);
  }
}
