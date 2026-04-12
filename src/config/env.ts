import { z } from 'zod';

// ─── LLM Provider union ───────────────────────────────────────────────────────

export const LLM_PROVIDERS = [
  'openai',
  'gemini',
  'groq',
  'custom', // Any OpenAI-compatible endpoint configured via CUSTOM_* env vars
  'vertex', // GCP Vertex AI
] as const;

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

  // ── LLM Provider selection ────────────────────────────────────────────────
  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('openai'),

  // ── OpenAI ────────────────────────────────────────────────────────────────
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // ── Google Gemini (direct API) ────────────────────────────────────────────
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),

  // ── Groq ──────────────────────────────────────────────────────────────────
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),

  // ── Custom OpenAI-compatible provider ────────────────────────────────────
  // Connects to any service that speaks the OpenAI chat completions protocol.
  // The base URL and key live only in .env — no service name appears in code.
  CUSTOM_API_KEY: z.string().optional(),
  CUSTOM_BASE_URL: z.string().url().optional(),
  CUSTOM_MODEL: z.string().default('gpt-4.1-mini'),

  // ── GCP Vertex AI ─────────────────────────────────────────────────────────
  VERTEX_PROJECT: z.string().optional(),
  VERTEX_LOCATION: z.string().default('us-central1'),
  VERTEX_MODEL: z.string().default('gemini-2.0-flash-001'),
  // Path to a service-account JSON key file (optional — ADC is used otherwise)
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

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
  EMAIL_FROM: z.string().default('Spendly <noreply@spendly.app>'),

  // ── Razorpay ──────────────────────────────────────────────────────────────
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_PLAN_ID: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
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

  // Map each provider to the credential that proves it is configured.
  // For 'vertex' we check the project ID (auth is via ADC, no API key needed).
  // For 'custom' we check both key and URL.
  const providerReadyMap: Record<LlmProvider, boolean> = {
    openai: !!data.OPENAI_API_KEY,
    gemini: !!data.GEMINI_API_KEY,
    groq: !!data.GROQ_API_KEY,
    custom: !!data.CUSTOM_API_KEY && !!data.CUSTOM_BASE_URL,
    vertex: !!data.VERTEX_PROJECT,
  };

  const providerHints: Record<LlmProvider, string> = {
    openai: 'Set OPENAI_API_KEY in your .env file.',
    gemini: 'Set GEMINI_API_KEY in your .env file.',
    groq: 'Set GROQ_API_KEY in your .env file.',
    custom: 'Set CUSTOM_API_KEY and CUSTOM_BASE_URL in your .env file.',
    vertex:
      'Set VERTEX_PROJECT (GCP project ID) in your .env file. ' +
      'Auth via Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.',
  };

  if (!providerReadyMap[data.LLM_PROVIDER]) {
    console.error(
      `❌ LLM_PROVIDER is set to "${data.LLM_PROVIDER}" but required config is missing.`,
    );
    console.error(`   ${providerHints[data.LLM_PROVIDER]}`);
    process.exit(1);
  }

  return data;
}

export const env = validateEnv();
export type Env = typeof env;
