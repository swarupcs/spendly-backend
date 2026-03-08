import { z } from 'zod';

// ─── LLM Provider union ───────────────────────────────────────────────────────

export const LLM_PROVIDERS = ['openai', 'gemini', 'groq'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const envSchema = z.object({
  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),

  // ── Auth ──────────────────────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().min(10).max(14).default(12),

  // ── LLM Provider ─────────────────────────────────────────────────────────
  /** Which AI provider powers the chat agent. */
  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('openai'),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // Google Gemini
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),

  // Groq
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),

  // ── Server ────────────────────────────────────────────────────────────────
  PORT: z.coerce.number().default(4100),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // ── Google OAuth ─────────────────────────────────────────────────────────
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required'),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url('GOOGLE_REDIRECT_URI must be a valid URL'),

  // ── Rate limiting ─────────────────────────────────────────────────────────
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(10),

  // ── Email (Resend) ────────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  EMAIL_FROM: z.string().default('ExpenseAI <noreply@expenseai.app>'),
});

// ─── Cross-field validation ───────────────────────────────────────────────────

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    result.error.issues.forEach((issue) => {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }

  const data = result.data;

  // Ensure the active provider's API key is present
  const providerKeyMap: Record<LlmProvider, string | undefined> = {
    openai: data.OPENAI_API_KEY,
    gemini: data.GEMINI_API_KEY,
    groq: data.GROQ_API_KEY,
  };

  if (!providerKeyMap[data.LLM_PROVIDER]) {
    console.error(
      `❌ LLM_PROVIDER is set to "${data.LLM_PROVIDER}" but the corresponding API key is missing.`,
    );
    console.error(
      `   Set ${data.LLM_PROVIDER.toUpperCase()}_API_KEY in your .env file.`,
    );
    process.exit(1);
  }

  return data;
}

export const env = validateEnv();
export type Env = typeof env;
