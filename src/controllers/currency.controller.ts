import type { Request, Response, NextFunction } from 'express';
import { getRatesService } from '../services/currency.service';

// GET /api/currency/rates?base=INR
export async function getRates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const base = (req.query.base as string) || 'INR';
    const rates = await getRatesService(base.toUpperCase());
    res.json({ success: true, data: { base: base.toUpperCase(), rates } });
  } catch (err) { next(err); }
}
