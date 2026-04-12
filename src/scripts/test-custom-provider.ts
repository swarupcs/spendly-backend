/**
 * test-custom-provider.ts
 * ─────────────────────────────────────────────────────────────────
 * Quick smoke-test for the CUSTOM LLM provider.
 * Reads credentials from your .env file — no source changes needed.
 *
 * Run:
 *   npx ts-node --env-file=.env src/scripts/test-custom-provider.ts
 *   OR (if you use tsx):
 *   npx tsx --env-file=.env src/scripts/test-custom-provider.ts
 */

import 'dotenv/config';

// ── Read env vars directly — bypass the full Zod schema so we only
//    need CUSTOM_* to be set, not every other required variable. ──────────────

const API_KEY  = process.env.CUSTOM_API_KEY;
const BASE_URL = process.env.CUSTOM_BASE_URL;
const MODEL    = process.env.CUSTOM_MODEL ?? 'gpt-4.1-mini';

// ── Colour helpers ────────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

function pass(msg: string)  { console.log(`${c.green}  ✔  ${c.reset}${msg}`); }
function fail(msg: string)  { console.log(`${c.red}  ✘  ${c.reset}${msg}`); }
function info(msg: string)  { console.log(`${c.cyan}  ℹ  ${c.reset}${msg}`); }
function warn(msg: string)  { console.log(`${c.yellow}  ⚠  ${c.reset}${msg}`); }
function sep()              { console.log(`${c.gray}${'─'.repeat(60)}${c.reset}`); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold}Custom Provider — Smoke Test${c.reset}`);
  sep();

  // ── Step 1: env var check ─────────────────────────────────────────────────
  console.log('\n[1/3] Checking environment variables…');

  let envOk = true;

  if (API_KEY) {
    pass(`CUSTOM_API_KEY   found  (${c.gray}${API_KEY.slice(0, 6)}…${c.reset})`);
  } else {
    fail('CUSTOM_API_KEY   is NOT set');
    envOk = false;
  }

  if (BASE_URL) {
    pass(`CUSTOM_BASE_URL  found  (${c.gray}${BASE_URL}${c.reset})`);
  } else {
    fail('CUSTOM_BASE_URL  is NOT set');
    envOk = false;
  }

  pass(`CUSTOM_MODEL     → ${c.gray}${MODEL}${c.reset}`);

  if (!envOk) {
    console.log(`\n${c.red}Aborting — fix the missing env vars above and retry.${c.reset}\n`);
    process.exit(1);
  }

  // ── Step 2: reachability check (HEAD / GET on base URL) ───────────────────
  console.log('\n[2/3] Checking endpoint reachability…');

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8_000);

    const probe = await fetch(BASE_URL!, {
      method: 'GET',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    // Any HTTP response (even 404 / 401) means the host is reachable
    pass(`Host responded  →  HTTP ${probe.status} ${probe.statusText}`);

    if (probe.status === 401) {
      warn('HTTP 401 — host is up but may need a valid API key (expected at this stage).');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('timeout')) {
      fail(`Timeout — no response from ${BASE_URL} within 8 s`);
    } else {
      fail(`Network error — ${msg}`);
    }
    console.log(`\n${c.red}Aborting — endpoint is not reachable.${c.reset}\n`);
    process.exit(1);
  }

  // ── Step 3: live inference call ───────────────────────────────────────────
  console.log('\n[3/3] Sending a test chat completion request…');
  info(`POST ${BASE_URL}/chat/completions`);
  info(`Model: ${MODEL}`);

  const payload = {
    model: MODEL,
    messages: [
      {
        role: 'user',
        content:
          'Reply with EXACTLY this JSON and nothing else: {"status":"ok","provider":"custom"}',
      },
    ],
    max_tokens: 64,
    temperature: 0,
  };

  let responseText = '';
  let durationMs   = 0;

  try {
    const t0  = Date.now();
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    durationMs = Date.now() - t0;

    const raw = await res.text();

    if (!res.ok) {
      fail(`HTTP ${res.status} — ${raw.slice(0, 300)}`);
      process.exit(1);
    }

    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?:   { message?: string };
    };

    if (json.error) {
      fail(`API error — ${json.error.message}`);
      process.exit(1);
    }

    responseText = json.choices?.[0]?.message?.content?.trim() ?? '';

    if (!responseText) {
      fail('Response parsed but content is empty.');
      process.exit(1);
    }

    pass(`HTTP 200  (${durationMs} ms)`);
    pass(`Model replied:\n\n        ${c.cyan}${responseText}${c.reset}\n`);

    // Bonus: verify the model followed instructions
    try {
      const parsed = JSON.parse(responseText) as Record<string, unknown>;
      if (parsed['status'] === 'ok') {
        pass('Model followed JSON instruction correctly ✓');
      } else {
        warn('Model replied but did not follow the JSON instruction exactly (still functional).');
      }
    } catch {
      warn('Reply is not strict JSON — the model is responding but may not follow instructions precisely.');
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Request failed — ${msg}`);
    process.exit(1);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  sep();
  console.log(`\n${c.green}${c.bold}All checks passed — custom provider is working correctly.${c.reset}\n`);
}

main().catch((err) => {
  console.error(`\n${c.red}Unexpected error:${c.reset}`, err);
  process.exit(1);
});