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

## Summary Priority Matrix

| # | Severity | Issue | Effort |
|---|----------|-------|--------|
| 1 | 🔴 Critical | OAuth tokens in URL | Medium |
| 2 | 🔴 High | Timing attack on webhook sig | Low |
| 3 | 🔴 High | Admin no input validation | Low |
| 7 | 🟠 High | Shared OAuth client state | Low |
| 5 | 🟠 High | Missing rate limits | Low |
| 6 | 🟠 High | Prisma client in devDeps | Trivial |
| 4 | 🟡 Medium | Health endpoint info leak | Trivial |
| 8 | 🟡 Medium | CSP disabled | Medium |
| 9 | 🟡 Medium | N+1 queries | Medium |
| 10 | 🟡 Medium | Duplicate API clients | Medium |
