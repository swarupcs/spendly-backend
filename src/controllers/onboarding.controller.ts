import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index';
import {
  processOnboardingMessage,
  getOnboardingWelcome,
  applyOnboardingActions,
  type OnboardingState,
  type OnboardingMessage,
} from '../services/onboarding.service';

// ─── GET /api/onboarding/welcome ──────────────────────────────────────────────

export async function getWelcome(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const message = await getOnboardingWelcome();
    res.json({
      success: true,
      data: {
        message,
        initialState: { step: 'WELCOME' } as OnboardingState,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/onboarding/message ─────────────────────────────────────────────
// Body: { message, state, history, applyActions? }

export async function sendOnboardingMessage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const {
      message,
      state,
      history,
      applyActions = true,
    } = req.body as {
      message: string;
      state: OnboardingState;
      history: OnboardingMessage[];
      applyActions?: boolean;
    };

    if (!message || !state) {
      res
        .status(400)
        .json({ success: false, error: 'message and state are required.' });
      return;
    }

    const result = await processOnboardingMessage(
      userId,
      message,
      state,
      history ?? [],
    );

    // Apply side effects (budget/goal creation) if requested
    if (applyActions && result.actions && result.actions.length > 0) {
      await applyOnboardingActions(userId, result.actions);
    }

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
