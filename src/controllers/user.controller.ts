import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index';
import type { UpdateUserSettingsInput } from '../lib/schemas';
import { getUserSettingsService, updateUserSettingsService } from '../services/user.service';

// ─── GET /api/user/settings ───────────────────────────────────────────────────

export async function getUserSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { sub: userId } = (req as AuthenticatedRequest).user;
    const settings = await getUserSettingsService(userId);
    res.json({ success: true, data: settings });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/user/settings ─────────────────────────────────────────────────

export async function updateUserSettings(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { sub: userId } = (req as AuthenticatedRequest).user;
    const settings = await updateUserSettingsService(userId, req.body as UpdateUserSettingsInput);
    res.json({ success: true, data: settings, message: 'Settings saved.' });
  } catch (err) {
    next(err);
  }
}
