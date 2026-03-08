import { prisma } from '../config/db';
import type { UpdateUserSettingsInput, UpdateProfileInput } from '../lib/schemas';

const SETTINGS_SELECT = {
  emailNotifications: true,
  budgetAlerts: true,
  weeklyReport: true,
  onboardingCompleted: true,
  currency: true,
  alertThreshold: true,
} as const;

// ─── Update Profile ───────────────────────────────────────────────────────────

export async function updateProfileService(userId: number, input: UpdateProfileInput) {
  return prisma.user.update({
    where: { id: userId },
    data: { name: input.name },
    select: {
      id: true, name: true, email: true, role: true, isActive: true,
      authProvider: true, emailVerified: true, createdAt: true, lastLoginAt: true,
      _count: { select: { expenses: true } },
    },
  });
}

// ─── Delete Account ───────────────────────────────────────────────────────────

export async function deleteAccountService(userId: number) {
  await prisma.user.delete({ where: { id: userId } });
}

// ─── Get User Settings ────────────────────────────────────────────────────────

export async function getUserSettingsService(userId: number) {
  // For brand-new users (no existing record), check whether they already have
  // expenses. If yes, they are an existing user — skip onboarding automatically.
  const existing = await prisma.userSettings.findUnique({ where: { userId } });

  if (!existing) {
    const expenseCount = await prisma.expense.count({ where: { userId } });
    const onboardingCompleted = expenseCount > 0;
    return prisma.userSettings.create({
      data: { userId, onboardingCompleted },
      select: SETTINGS_SELECT,
    });
  }

  return prisma.userSettings.findUniqueOrThrow({
    where: { userId },
    select: SETTINGS_SELECT,
  });
}

// ─── Update User Settings ─────────────────────────────────────────────────────

export async function updateUserSettingsService(
  userId: number,
  input: UpdateUserSettingsInput,
) {
  return prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
    select: SETTINGS_SELECT,
  });
}
