import { getLlm } from '../agents/llm.factory';
import { prisma } from '../config/db';
import type { Category } from '../generated/prisma';

export interface ParsedReceipt {
  title: string;
  amount: number;
  currency: string;
  category: Category;
  date: string;
  merchant?: string;
  notes?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rawText?: string;
}

export interface BulkParseResult {
  expenses: ParsedExpenseEntry[];
  unparsed: string[];
  totalAmount: number;
}

export interface ParsedExpenseEntry {
  title: string;
  amount: number;
  category: Category;
  date?: string;
  notes?: string;
}

// ─── Parse receipt image using vision LLM ────────────────────────────────────

export async function parseReceiptImage(
  base64Image: string,
  mediaType: string,
): Promise<ParsedReceipt> {
  const llm = getLlm();

  const systemPrompt = `You are a receipt parsing assistant. Extract expense information from receipt images.
Respond ONLY with a valid JSON object (no markdown, no explanation) with these fields:
{
  "title": "short merchant/item description",
  "amount": number (final total amount),
  "currency": "INR" (or detected currency code),
  "category": one of: DINING|SHOPPING|TRANSPORT|ENTERTAINMENT|UTILITIES|HEALTH|EDUCATION|OTHER,
  "date": "YYYY-MM-DD" (from receipt, or today if not found),
  "merchant": "merchant name if visible",
  "notes": "any relevant notes",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`;

  const today = new Date().toISOString().split('T')[0];

  const messages = [
    {
      role: 'user' as const,
      content: [
        {
          type: 'image_url' as const,
          image_url: {
            url: `data:${mediaType};base64,${base64Image}`,
          },
        },
        {
          type: 'text' as const,
          text: `Parse this receipt. Today's date is ${today}. Return only JSON.`,
        },
      ],
    },
  ];

  // Use a type-safe invocation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (llm as any).invoke(messages);
  const content =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  // Strip markdown fences if present
  const clean = content
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  const parsed = JSON.parse(clean) as ParsedReceipt;

  // Validate and sanitize
  const validCategories: Category[] = [
    'DINING',
    'SHOPPING',
    'TRANSPORT',
    'ENTERTAINMENT',
    'UTILITIES',
    'HEALTH',
    'EDUCATION',
    'OTHER',
  ];

  if (!validCategories.includes(parsed.category)) {
    parsed.category = 'OTHER';
  }

  if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    parsed.date = today;
  }

  if (!parsed.amount || parsed.amount <= 0) {
    throw new Error('Could not extract a valid amount from the receipt.');
  }

  if (!parsed.currency) parsed.currency = 'INR';

  return parsed;
}

// ─── Bulk expense parsing from natural language ───────────────────────────────
// e.g. "spent 200 on lunch, 500 on uber, 150 on chai"

export async function parseBulkExpenses(
  text: string,
): Promise<BulkParseResult> {
  const llm = getLlm();

  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `You are an expense parsing assistant. Parse the user's message into individual expense entries.
Respond ONLY with a valid JSON object (no markdown) with this structure:
{
  "expenses": [
    {
      "title": "description",
      "amount": number,
      "category": one of: DINING|SHOPPING|TRANSPORT|ENTERTAINMENT|UTILITIES|HEALTH|EDUCATION|OTHER,
      "date": "YYYY-MM-DD or null",
      "notes": "optional notes or null"
    }
  ],
  "unparsed": ["any text that couldn't be parsed as an expense"]
}

Rules:
- Extract every expense mentioned
- Infer category from context (chai/tea/food=DINING, uber/ola/auto=TRANSPORT, etc.)
- If no date mentioned, use null (will default to today: ${today})
- All amounts in INR unless specified otherwise`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (llm as any).invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: text },
  ]);

  const content =
    typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

  const clean = content
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
  const parsed = JSON.parse(clean) as BulkParseResult;

  const validCategories: Category[] = [
    'DINING',
    'SHOPPING',
    'TRANSPORT',
    'ENTERTAINMENT',
    'UTILITIES',
    'HEALTH',
    'EDUCATION',
    'OTHER',
  ];

  // Sanitize
  parsed.expenses = (parsed.expenses ?? [])
    .filter((e) => e.amount > 0)
    .map((e) => ({
      ...e,
      category: validCategories.includes(e.category) ? e.category : 'OTHER',
    }));

  parsed.totalAmount = parsed.expenses.reduce((s, e) => s + e.amount, 0);

  return parsed;
}

// ─── Parse CSV bank statement ─────────────────────────────────────────────────

export interface CsvParseResult {
  rows: Array<{
    date: string;
    title: string;
    amount: number;
    category: Category;
    raw: Record<string, string>;
  }>;
  totalRows: number;
  totalAmount: number;
  errors: string[];
}

export async function parseBankStatementCsv(
  csvContent: string,
): Promise<CsvParseResult> {
  const lines = csvContent.split('\n').filter((l) => l.trim());
  if (lines.length < 2)
    throw new Error('CSV must have at least a header row and one data row.');

  const headers = lines[0]
    .split(',')
    .map((h) => h.replace(/"/g, '').trim().toLowerCase());

  // Common header mappings
  const dateKeys = [
    'date',
    'transaction date',
    'txn date',
    'value date',
    'posting date',
  ];
  const descKeys = [
    'description',
    'narration',
    'particulars',
    'merchant',
    'details',
    'remarks',
  ];
  const amountKeys = ['debit', 'amount', 'withdrawal', 'dr', 'debit amount'];

  const findCol = (keys: string[]) =>
    headers.findIndex((h) => keys.some((k) => h.includes(k)));

  const dateIdx = findCol(dateKeys);
  const descIdx = findCol(descKeys);
  const amtIdx = findCol(amountKeys);

  if (dateIdx === -1 || descIdx === -1 || amtIdx === -1) {
    throw new Error(
      `Could not detect columns. Found: ${headers.join(', ')}. ` +
        'Expected columns for date, description, and debit/amount.',
    );
  }

  // Use LLM to batch-categorize
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.replace(/"/g, '').trim());
    const rawRow: Record<string, string> = {};
    headers.forEach((h, i) => {
      rawRow[h] = cols[i] ?? '';
    });
    return rawRow;
  });

  const errors: string[] = [];
  const result: CsvParseResult['rows'] = [];

  // Process in batches of 20 for LLM categorization
  const BATCH_SIZE = 20;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const descriptions = batch.map((r, idx) => ({
      idx,
      desc: r[headers[descIdx]] ?? '',
      amount: parseFloat((r[headers[amtIdx]] ?? '0').replace(/,/g, '')),
    }));

    const batchText = descriptions
      .map((d) => `${d.idx}: "${d.desc}" - ₹${d.amount}`)
      .join('\n');

    let categoryMap: Record<number, Category> = {};
    try {
      const llm = getLlm();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (llm as any).invoke([
        {
          role: 'system',
          content:
            'Categorize each expense. Reply ONLY with JSON: {"0": "DINING", "1": "TRANSPORT", ...}. ' +
            'Categories: DINING|SHOPPING|TRANSPORT|ENTERTAINMENT|UTILITIES|HEALTH|EDUCATION|OTHER',
        },
        { role: 'user', content: batchText },
      ]);
      const respText =
        typeof resp.content === 'string'
          ? resp.content
          : JSON.stringify(resp.content);
      categoryMap = JSON.parse(
        respText
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim(),
      );
    } catch {
      // Fall back to OTHER if LLM fails
      descriptions.forEach((d) => {
        categoryMap[d.idx] = 'OTHER';
      });
    }

    for (const { idx, desc, amount } of descriptions) {
      if (isNaN(amount) || amount <= 0) {
        errors.push(
          `Row ${i + idx + 2}: Invalid amount "${batch[idx]?.[headers[amtIdx]]}"`,
        );
        continue;
      }

      const rawDate = batch[idx]?.[headers[dateIdx]] ?? '';
      let parsedDate = new Date().toISOString().split('T')[0];
      if (rawDate) {
        // Try parsing common Indian date formats
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          parsedDate = d.toISOString().split('T')[0];
        }
      }

      result.push({
        date: parsedDate,
        title: desc || 'Bank Transaction',
        amount: Math.round(amount * 100) / 100,
        category: (categoryMap[idx] as Category) ?? 'OTHER',
        raw: batch[idx] ?? {},
      });
    }
  }

  return {
    rows: result,
    totalRows: result.length,
    totalAmount:
      Math.round(result.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    errors,
  };
}

// ─── Bulk create expenses from parsed data ────────────────────────────────────

export async function bulkCreateFromParsed(
  userId: number,
  entries: Array<{
    title: string;
    amount: number;
    category: Category;
    date?: string | null;
    notes?: string | null;
  }>,
): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  await prisma.expense.createMany({
    data: entries.map((e) => ({
      userId,
      title: e.title,
      amount: e.amount,
      convertedAmount: e.amount,
      category: e.category,
      date: e.date ?? today,
      notes: e.notes ?? undefined,
    })),
  });

  return entries.length;
}
