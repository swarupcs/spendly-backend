import { prisma } from '../config/db';
import type { UpdateUserSettingsInput } from '../lib/schemas';

// ─── Get User Settings ────────────────────────────────────────────────────────

export async function getUserSettingsService(userId: number) {
  // Upsert: returns existing or creates defaults on first access
  const settings = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: {
      emailNotifications: true,
      budgetAlerts: true,
      weeklyReport: true,
    },
  });
  return settings;
}

// ─── Update User Settings ─────────────────────────────────────────────────────

export async function updateUserSettingsService(
  userId: number,
  input: UpdateUserSettingsInput,
) {
  const settings = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
    select: {
      emailNotifications: true,
      budgetAlerts: true,
      weeklyReport: true,
    },
  });
  return settings;
}
