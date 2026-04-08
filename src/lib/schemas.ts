import { z } from 'zod';
import { Category, Frequency, GoalType } from '../generated/prisma';

// ─── Auth Schemas ─────────────────────────────────────────────────────────────

export const signUpSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name too long')
    .trim(),
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
});

export const signInSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

// ─── Expense Schemas ──────────────────────────────────────────────────────────

const categoryValues = Object.values(Category) as [Category, ...Category[]];

export const createExpenseSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title too long')
    .trim(),
  amount: z
    .number({ error: 'Amount must be a number' })
    .positive('Amount must be positive')
    .max(10_000_000),
  currency: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  category: z.enum(categoryValues).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  notes: z.string().max(1000, 'Notes too long').optional(),
  merchant: z.string().max(100).optional(),
  isTaxDeductible: z.boolean().optional(),
});

export const updateExpenseSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  amount: z.number().positive().max(10_000_000).optional(),
  currency: z.string().min(3).max(3).optional(),
  exchangeRate: z.number().positive().optional(),
  category: z.enum(categoryValues).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  notes: z.string().max(1000).optional(),
  merchant: z.string().max(100).optional(),
  isTaxDeductible: z.boolean().optional(),
});

export const updateNetWorthSchema = z.object({
  netWorthAssets: z.number().min(0).max(100_000_000_000).optional(),
  netWorthLiabilities: z.number().min(0).max(100_000_000_000).optional(),
  monthlyIncome: z.number().positive().max(100_000_000).optional(),
});

export const expenseFiltersSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  category: z.enum(categoryValues).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(2000).default(20),
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'At least one ID required'),
});

// ─── Password Reset Schemas ───────────────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128)
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Must contain at least one number'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

// ─── Email Verification Schemas ───────────────────────────────────────────────

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
});

// ─── Budget Schemas ───────────────────────────────────────────────────────────

export const upsertBudgetSchema = z.object({
  category: z.enum(categoryValues),
  amount: z
    .number({ error: 'Amount must be a number' })
    .positive('Amount must be positive')
    .max(10_000_000),
});

export const budgetOverviewSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM')
    .optional(),
});

// ─── Profile Schema ───────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name too long')
    .trim(),
});

// ─── User Settings Schema ─────────────────────────────────────────────────────

export const updateUserSettingsSchema = z.object({
  emailNotifications: z.boolean().optional(),
  budgetAlerts: z.boolean().optional(),
  weeklyReport: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
  currency: z.string().min(3).max(3).optional(),
  alertThreshold: z.number().positive().max(10_000_000).nullable().optional(),
  monthlyIncome: z.number().positive().max(100_000_000).optional(),
  netWorthAssets: z.number().min(0).max(100_000_000_000).optional(),
  netWorthLiabilities: z.number().min(0).max(100_000_000_000).optional(),
});

// ─── Recurring Expense Schemas ────────────────────────────────────────────────

const frequencyValues = Object.values(Frequency) as [Frequency, ...Frequency[]];

export const createRecurringSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title too long')
    .trim(),
  amount: z
    .number({ error: 'Amount must be a number' })
    .positive('Amount must be positive')
    .max(10_000_000),
  category: z.enum(categoryValues).optional(),
  frequency: z.enum(frequencyValues),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  notes: z.string().max(1000).optional(),
});

export const updateRecurringSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  amount: z.number().positive().max(10_000_000).optional(),
  category: z.enum(categoryValues).optional(),
  frequency: z.enum(frequencyValues).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

// ─── Financial Goal Schemas ───────────────────────────────────────────────────

const goalTypeValues = Object.values(GoalType) as [GoalType, ...GoalType[]];

export const createGoalSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name too long').trim(),
  type: z.enum(goalTypeValues),
  targetAmount: z
    .number({ error: 'Amount must be a number' })
    .positive('Amount must be positive')
    .max(100_000_000),
  currentAmount: z.number().min(0).max(100_000_000).optional(),
  category: z.enum(categoryValues).optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Period must be YYYY-MM')
    .optional(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Deadline must be YYYY-MM-DD')
    .optional(),
  notes: z.string().max(1000).optional(),
});

export const updateGoalSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  targetAmount: z.number().positive().max(100_000_000).optional(),
  currentAmount: z.number().min(0).max(100_000_000).optional(),
  category: z.enum(categoryValues).optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  isCompleted: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

// ─── Chat Schemas ─────────────────────────────────────────────────────────────

export const chatQuerySchema = z.object({
  query: z
    .string()
    .min(1, 'Query is required')
    .max(2000, 'Query too long')
    .trim(),
  threadId: z.string().max(100).optional(),
});

// Google OAuth
export const googleAuthSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
});

export const googleCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExpenseFiltersInput = z.infer<typeof expenseFiltersSchema>;
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;
export type ChatQueryInput = z.infer<typeof chatQuerySchema>;

export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type GoogleCallbackInput = z.infer<typeof googleCallbackSchema>;

export type UpsertBudgetInput = z.infer<typeof upsertBudgetSchema>;
export type BudgetOverviewInput = z.infer<typeof budgetOverviewSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;
export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type UpdateNetWorthInput = z.infer<typeof updateNetWorthSchema>;