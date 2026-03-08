import { env } from '../config/env';
import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types/index';
import type {
  SignUpInput,
  SignInInput,
  RefreshTokenInput,
  ChangePasswordInput,
  GoogleAuthInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  VerifyEmailInput,
  ResendVerificationInput,
} from '../lib/schemas';
import {
  signUpService,
  signInService,
  refreshTokenService,
  logoutService,
  getMeService,
  changePasswordService,
  googleAuthService,
  googleTokenAuthService,
  forgotPasswordService,
  resetPasswordService,
  verifyEmailService,
  resendVerificationService,
} from '../services/auth.service';

import { getGoogleAuthUrl } from '../lib/google-oauth';

// ─── GET /api/auth/google ─────────────────────────────────────────────────────

export async function getGoogleAuthUrlController(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const url = getGoogleAuthUrl();
    res.json({ success: true, data: { url } });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/google/callback ──────────────────────────────────────────

export async function googleAuthCallback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await googleAuthService(req.body as GoogleAuthInput);
    res.json({
      success: true,
      message: 'Signed in with Google successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/google/token ──────────────────────────────────────────────

export async function googleTokenAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { idToken } = req.body as { idToken: string };
    if (!idToken) {
      res.status(400).json({ success: false, error: 'ID token is required' });
      return;
    }
    const result = await googleTokenAuthService(idToken);
    res.json({
      success: true,
      message: 'Signed in with Google successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/signup ────────────────────────────────────────────────────

export async function signUp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await signUpService(req.body as SignUpInput);
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/signin ────────────────────────────────────────────────────

export async function signIn(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await signInService(req.body as SignInInput);
    res.json({
      success: true,
      message: 'Signed in successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

export async function refreshToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { refreshToken: token } = req.body as RefreshTokenInput;
    const tokens = await refreshTokenService(token);
    res.json({ success: true, message: 'Tokens refreshed', data: { tokens } });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { refreshToken: token } = req.body as RefreshTokenInput;
    await logoutService(token);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { sub: userId } = (req as AuthenticatedRequest).user;
    const user = await getMeService(userId);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/auth/change-password ─────────────────────────────────────────

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { sub: userId } = (req as AuthenticatedRequest).user;
    await changePasswordService(userId, req.body as ChangePasswordInput);
    res.json({
      success: true,
      message: 'Password changed. Please sign in again on all devices.',
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await forgotPasswordService(req.body as ForgotPasswordInput);
    // Always 200 — prevent user enumeration
    res.json({
      success: true,
      message: 'If that email is registered, a reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await resetPasswordService(req.body as ResetPasswordInput);
    res.json({
      success: true,
      message: 'Password reset successfully. Please sign in with your new password.',
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────

export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await verifyEmailService(req.body as VerifyEmailInput);
    res.json({ success: true, message: 'Email verified successfully.' });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/auth/resend-verification ──────────────────────────────────────

export async function resendVerification(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await resendVerificationService(req.body as ResendVerificationInput);
    res.json({
      success: true,
      message: 'If that email is registered and unverified, a new link has been sent.',
    });
  } catch (err) {
    next(err);
  }
}

export async function googleAuthCallbackGet(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  try {
    const { code, error } = req.query;

    if (error) {
      console.error('Google OAuth error:', error);
      return res.redirect(`${env.FRONTEND_URL}/login?error=google_auth_failed`);
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(`${env.FRONTEND_URL}/login?error=google_auth_failed`);
    }

    const result = await googleAuthService({ code });

    const params = new URLSearchParams({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      user: JSON.stringify(result.user),
    });

    res.redirect(
      `${env.FRONTEND_URL}/auth/google/callback?${params.toString()}`,
    );
  } catch (err) {
    console.error('Google auth callback error:', err);
    res.redirect(`${env.FRONTEND_URL}/login?error=google_auth_failed`);
  }
}