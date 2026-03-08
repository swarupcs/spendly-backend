import crypto from 'crypto';
import { prisma } from '../config/db';
import { hashPassword, comparePassword } from '../lib/hash';
import {
  generateTokenPair,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from '../lib/jwt';
import { AppError } from '../middleware/errorHandler';
import { getGoogleUserInfo, verifyGoogleToken } from '../lib/google-oauth';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../lib/email';
import type {
  SignUpInput,
  SignInInput,
  ChangePasswordInput,
  GoogleAuthInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  VerifyEmailInput,
  ResendVerificationInput,
} from '../lib/schemas';
import type { PublicUser, TokenPair } from '../types/index';

const DUMMY_HASH =
  '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeANHBfElmfNyD1ra';

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

// ─── Sign Up ──────────────────────────────────────────────────────────────────

export async function signUpService(input: SignUpInput): Promise<AuthResult> {
  const { name, email, password } = input;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    throw new AppError(409, 'Email already registered');
  }

  const passwordHash = await hashPassword(password);

  const emailVerificationToken = crypto.randomBytes(32).toString('hex');
  const emailVerificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      emailVerificationToken,
      emailVerificationTokenExpiry,
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true, emailVerified: true },
  });

  const tokens = generateTokenPair(user.id, user.email, user.role);

  await prisma.refreshToken.create({
    data: {
      token: tokens.refreshToken,
      userId: user.id,
      expiresAt: getRefreshTokenExpiry(),
    },
  });

  // Fire-and-forget — don't block signup if email fails
  sendVerificationEmail(user.email, user.name, emailVerificationToken).catch(console.error);

  return { user, tokens };
}

// ─── Sign In ──────────────────────────────────────────────────────────────────

export async function signInService(input: SignInInput): Promise<AuthResult> {
  const { email, password } = input;

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      passwordHash: true,
      isActive: true,
      authProvider: true,
      createdAt: true,
    },
  });

  // Check if user exists and has a password set
  if (user?.authProvider === 'google' && !user.passwordHash) {
    throw new AppError(
      400,
      'This account uses Google Sign-In. Please sign in with Google.',
    );
  }

  // Always run bcrypt compare to prevent timing attacks
  const isValid = await comparePassword(
    password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !isValid) {
    throw new AppError(401, 'Invalid email or password');
  }

  if (!user.isActive) {
    throw new AppError(403, 'Account deactivated. Please contact support.');
  }

  const tokens = generateTokenPair(user.id, user.email, user.role);

  await Promise.all([
    prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: getRefreshTokenExpiry(),
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
  ]);

  const { passwordHash: _omit, ...publicUser } = user;
  return { user: publicUser, tokens };
}

// ─── Google OAuth Sign In ─────────────────────────────────────────────────────

export async function googleAuthService(
  input: GoogleAuthInput,
): Promise<AuthResult> {
  const { code } = input;

  // Exchange code for user info
  const googleUser = await getGoogleUserInfo(code);

  if (!googleUser.verified_email) {
    throw new AppError(400, 'Google email not verified');
  }

  // Find or create user
  let user = await prisma.user.findUnique({
    where: { email: googleUser.email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      googleId: true,
      authProvider: true,
      createdAt: true,
    },
  });

  if (user) {
    // Existing user - check if they signed up with local auth
    if (user.authProvider === 'local' && !user.googleId) {
      // Link Google account to existing local account
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: googleUser.id,
          googlePicture: googleUser.picture,
          authProvider: 'google', // Switch to google as primary
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          googleId: true,
          authProvider: true,
          createdAt: true,
        },
      });
    }

    if (!user.isActive) {
      throw new AppError(403, 'Account deactivated. Please contact support.');
    }
  } else {
    // New user - create account
    user = await prisma.user.create({
      data: {
        email: googleUser.email,
        name: googleUser.name,
        googleId: googleUser.id,
        googlePicture: googleUser.picture,
        authProvider: 'google',
        passwordHash: undefined, // No password for OAuth users
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        googleId: true,
        authProvider: true,
        createdAt: true,
      },
    });
  }

  // Generate tokens
  const tokens = generateTokenPair(user.id, user.email, user.role);

  // Store refresh token and update last login
  await Promise.all([
    prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: getRefreshTokenExpiry(),
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
  ]);

  return { user, tokens };
}

// ─── Google ID Token Verification (Direct Sign-In) ───────────────────────────

export async function googleTokenAuthService(
  idToken: string,
): Promise<AuthResult> {
  // Verify token with Google
  const googleUser = await verifyGoogleToken(idToken);

  if (!googleUser.verified_email) {
    throw new AppError(400, 'Google email not verified');
  }

  // Find or create user (same logic as above)
  let user = await prisma.user.findUnique({
    where: { email: googleUser.email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      googleId: true,
      authProvider: true,
      createdAt: true,
    },
  });

  if (user) {
    if (user.authProvider === 'local' && !user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: googleUser.id,
          googlePicture: googleUser.picture,
          authProvider: 'google',
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          googleId: true,
          authProvider: true,
          createdAt: true,
        },
      });
    }

    if (!user.isActive) {
      throw new AppError(403, 'Account deactivated. Please contact support.');
    }
  } else {
    user = await prisma.user.create({
      data: {
        email: googleUser.email,
        name: googleUser.name,
        googleId: googleUser.id,
        googlePicture: googleUser.picture,
        authProvider: 'google',
        passwordHash: undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        googleId: true,
        authProvider: true,
        createdAt: true,
      },
    });
  }

  const tokens = generateTokenPair(user.id, user.email, user.role);

  await Promise.all([
    prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: user.id,
        expiresAt: getRefreshTokenExpiry(),
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }),
  ]);

  return { user, tokens };
}

// ─── Refresh Tokens ───────────────────────────────────────────────────────────

export async function refreshTokenService(
  refreshToken: string,
): Promise<TokenPair> {
  let _payload: ReturnType<typeof verifyRefreshToken>;
  try {
    _payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, 'Invalid refresh token');
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: {
      user: { select: { id: true, email: true, role: true, isActive: true } },
    },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError(401, 'Refresh token expired or revoked');
  }

  if (!stored.user.isActive) {
    throw new AppError(403, 'Account deactivated');
  }

  // Rotate — revoke old token, issue new pair
  const tokens = generateTokenPair(
    stored.user.id,
    stored.user.email,
    stored.user.role,
  );

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        userId: stored.userId,
        expiresAt: getRefreshTokenExpiry(),
      },
    }),
  ]);

  return tokens;
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logoutService(refreshToken: string): Promise<void> {
  // Silently revoke — don't leak whether the token exists
  await prisma.refreshToken
    .update({
      where: { token: refreshToken },
      data: { revokedAt: new Date() },
    })
    .catch(() => undefined);
}

// ─── Get Current User ─────────────────────────────────────────────────────────

export async function getMeService(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      authProvider: true,
      googleId: true,
      googlePicture: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { expenses: true } },
    },
  });

  if (!user) throw new AppError(404, 'User not found');
  return user;
}

// ─── Change Password ──────────────────────────────────────────────────────────

export async function changePasswordService(
  userId: number,
  input: ChangePasswordInput,
): Promise<void> {
  const { currentPassword, newPassword } = input;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, authProvider: true },
  });

  if (!user) throw new AppError(404, 'User not found');

  // Check if user signed up with Google OAuth and doesn't have a password
  if (user.authProvider === 'google' && !user.passwordHash) {
    throw new AppError(
      400,
      'Cannot change password for Google accounts. Please manage your password through Google.',
    );
  }

  // User has a password (local auth or linked account)
  if (!user.passwordHash) {
    throw new AppError(400, 'No password set for this account');
  }

  const isValid = await comparePassword(currentPassword, user.passwordHash);
  if (!isValid) throw new AppError(401, 'Current password is incorrect');

  const newHash = await hashPassword(newPassword);

  // Update password AND revoke all refresh tokens — forces re-login on all devices
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

// ─── Verify Email ─────────────────────────────────────────────────────────────

export async function verifyEmailService(input: VerifyEmailInput): Promise<void> {
  const { token } = input;

  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: token },
    select: {
      id: true,
      emailVerified: true,
      emailVerificationTokenExpiry: true,
    },
  });

  if (!user) {
    throw new AppError(400, 'Invalid or expired verification link');
  }

  if (user.emailVerified) {
    return; // Already verified — idempotent
  }

  if (!user.emailVerificationTokenExpiry || user.emailVerificationTokenExpiry < new Date()) {
    throw new AppError(400, 'Verification link has expired. Please request a new one.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationTokenExpiry: null,
    },
  });
}

// ─── Resend Verification Email ────────────────────────────────────────────────

export async function resendVerificationService(input: ResendVerificationInput): Promise<void> {
  const { email } = input;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, emailVerified: true, isActive: true },
  });

  // Always return success to prevent user enumeration
  if (!user || !user.isActive || user.emailVerified) return;

  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificationToken: token, emailVerificationTokenExpiry: expiry },
  });

  sendVerificationEmail(user.email, user.name, token).catch(console.error);
}

// ─── Forgot Password ──────────────────────────────────────────────────────────

export async function forgotPasswordService(input: ForgotPasswordInput): Promise<void> {
  const { email } = input;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, isActive: true, authProvider: true },
  });

  // Always return success — prevent user enumeration
  if (!user || !user.isActive) return;

  // Google-only accounts have no password
  if (user.authProvider === 'google') return;

  const token = crypto.randomBytes(32).toString('hex');
  const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: token, passwordResetTokenExpiry: expiry },
  });

  sendPasswordResetEmail(user.email, user.name, token).catch(console.error);
}

// ─── Reset Password ───────────────────────────────────────────────────────────

export async function resetPasswordService(input: ResetPasswordInput): Promise<void> {
  const { token, newPassword } = input;

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: token },
    select: {
      id: true,
      passwordResetTokenExpiry: true,
    },
  });

  if (!user) {
    throw new AppError(400, 'Invalid or expired reset link');
  }

  if (!user.passwordResetTokenExpiry || user.passwordResetTokenExpiry < new Date()) {
    throw new AppError(400, 'Reset link has expired. Please request a new one.');
  }

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
      },
    }),
    // Revoke all sessions — forces re-login everywhere
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
