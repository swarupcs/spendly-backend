import 'dotenv/config';
import './config/env';

import process from 'node:process';
import express from 'express';

// Raise the EventEmitter limit before anything else registers listeners.
// nodemon restarts re-run this module and accumulate process.on() calls;
// 30 is a safe ceiling — a real leak would need to exceed this deliberately.
process.setMaxListeners(30);
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { connectDB, disconnectDB } from './config/db';
import { apiRouter } from './routes/index';
import { apiLimiter } from './middleware/rateLimiter';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import { env } from './config/env';
import { getLlmProviderInfo } from './agents/llm.factory';
import { processRecurringExpenses } from './services/recurring.service';
import {
  sendWeeklyReports,
  sendMonthlySummaries,
  sendAnomalyAlerts,
  sendGoalNudges,
} from './services/alert.service';

const app = express();

// ─── Security headers ─────────────────────────────────────────────────────────

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);

app.set('trust proxy', 1);

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(
  express.json({
    // Increase limit to 10MB to support base64 receipt images
    limit: '10mb',
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── HTTP logging ─────────────────────────────────────────────────────────────

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Rate limiting ────────────────────────────────────────────────────────────

app.use('/api', apiLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const llm = getLlmProviderInfo();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
    llm,
  });
});

// ─── API routes ───────────────────────────────────────────────────────────────

app.use('/api', apiRouter);

// ─── 404 + Error handling ─────────────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await connectDB();

  const llm = getLlmProviderInfo();

  const server = app.listen(env.PORT, () => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🚀  Server      → http://localhost:${env.PORT}`);
    console.log(`🔐  Auth        → http://localhost:${env.PORT}/api/auth`);
    console.log(`📊  Expenses    → http://localhost:${env.PORT}/api/expenses`);
    console.log(`💬  Chat        → http://localhost:${env.PORT}/api/chat`);
    console.log(`🔍  Insights    → http://localhost:${env.PORT}/api/insights`);
    console.log(`📥  Import      → http://localhost:${env.PORT}/api/import`);
    console.log(`💰  Finance     → http://localhost:${env.PORT}/api/finance`);
    console.log(
      `🎯  Onboarding  → http://localhost:${env.PORT}/api/onboarding`,
    );
    console.log(`🩺  Health      → http://localhost:${env.PORT}/health`);
    console.log(
      `🤖  LLM         → ${llm.provider.toUpperCase()} / ${llm.model}`,
    );
    console.log(`🌱  Env         → ${env.NODE_ENV}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n🛑  ${signal} — shutting down gracefully...`);
    server.close(async () => {
      await disconnectDB();
      console.log('👋  Server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('⚠️   Forcing shutdown after 10 s timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  // ── Recurring expense processor ─────────────────────────────────────────────
  processRecurringExpenses().catch(console.error);
  const recurringInterval = setInterval(
    () => processRecurringExpenses().catch(console.error),
    60 * 60 * 1000, // every hour
  );
  recurringInterval.unref();

  // ── Daily scheduler (runs every 24h) ─────────────────────────────────────────
  const dailyInterval = setInterval(
    () => {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
      const dayOfMonth = now.getDate();

      // Monday: weekly reports
      if (dayOfWeek === 1) {
        sendWeeklyReports().catch(console.error);
      }

      // 1st of month: monthly summaries
      if (dayOfMonth === 1) {
        sendMonthlySummaries().catch(console.error);
      }

      // Every day: anomaly alerts & goal nudges
      sendAnomalyAlerts().catch(console.error);
      sendGoalNudges().catch(console.error);
    },
    24 * 60 * 60 * 1000,
  );
  dailyInterval.unref();

  // Run daily alerts once at startup (non-blocking)
  setTimeout(() => {
    sendAnomalyAlerts().catch(console.error);
    sendGoalNudges().catch(console.error);
  }, 5000).unref();

  // ── Process signal handlers ────────────────────────────────────────────────
  // Remove any handlers added by a previous hot-reload before re-registering,
  // so we never accumulate duplicates across nodemon restarts.
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    console.error('💥  Uncaught exception:', err);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    console.error('💥  Unhandled rejection:', reason);
  });
}

start().catch((err: Error) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
