import { Router } from 'express';
import { authLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authenticate';
import {
  signUpSchema,
  signInSchema,
  refreshTokenSchema,
  changePasswordSchema,
  googleAuthSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
} from '../lib/schemas';
import {
  signUp,
  signIn,
  refreshToken,
  logout,
  getMe,
  changePassword,
  getGoogleAuthUrlController,
  googleAuthCallbackGet,
  googleAuthCallback,
  googleTokenAuth,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
} from '../controllers/auth.controller';

export const authRouter: Router = Router();

// Public — with strict per-IP rate limiting
authRouter.post('/signup', authLimiter, validate(signUpSchema), signUp);
authRouter.post('/signin', authLimiter, validate(signInSchema), signIn);
authRouter.post('/refresh', validate(refreshTokenSchema), refreshToken);
authRouter.post('/logout', validate(refreshTokenSchema), logout);

// Google OAuth routes
authRouter.get('/google', getGoogleAuthUrlController);
authRouter.get('/google/callback', authLimiter, googleAuthCallbackGet);  
authRouter.post(
  '/google/callback',
  authLimiter,
  validate(googleAuthSchema),
  googleAuthCallback,
);
authRouter.post('/google/token', authLimiter, googleTokenAuth);

// Password reset (public, rate-limited)
authRouter.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPassword);
authRouter.post('/reset-password', authLimiter, validate(resetPasswordSchema), resetPassword);

// Email verification (public)
authRouter.post('/verify-email', validate(verifyEmailSchema), verifyEmail);
authRouter.post('/resend-verification', authLimiter, validate(resendVerificationSchema), resendVerification);

// Protected — requires valid Bearer JWT
authRouter.get('/me', authenticate, getMe);
authRouter.patch(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  changePassword,
);
