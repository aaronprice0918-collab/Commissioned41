# MissionOS Lite — Adversarial API / Security Audit

**Date:** 2026-07-06
**Scope:** `app/api/**`, `lib/{entitlement,rateLimit,supabaseAdmin,alert,owner,owner-pulse}.ts`, `next.config.mjs`, `vercel.json`
**Method:** Full source read of every route + live black-box probing against the running dev server on `http://localhost:3011`.

> **Test-environment note:** the running server is a **DEV build** (CSP served with `'unsafe-eval'` ⇒ `NODE_ENV !== "production"`), and `CRON_SECRET` is **unset** in this environment. This means:
> - The `!active && IS_PROD` subscription gate is **inactive** locally — any signed-in account reaches the paid Anthropic routes. This is by-design dev convenience and is NOT a prod finding, but see LOW-3.
> - All three crons returned `503` ("not configured") rather than exercising the `Bearer` check. The fail-closed-on-missing-secret branch was confirmed live; the bad-secret `401` branch was confirmed by code read (`auth !== \`Bearer ${secret}\``).

---

## CONFIRMED ISSUES

### MEDIUM-1 — `/api/checkout` is unauthenticated AND unthrottled, and spins up real Stripe Checkout Sessions for arbitrary emails
**File:** `app/api/checkout/route.ts` (whole handler — no `getSessionEmail`/`getSessionUser`, no `rateLimited`; confirmed `grep -c` = 0).

**Scenario:** Any anonymous internet caller can POST an arbitrary `email` and receive a live hosted Stripe Checkout URL bound to that address. There is no session check and no rate limit, so this is an unauthenticated lever against the Stripe API (quota/cost) and an email-spoofing/spam vector (checkout pages pre-filled with a victim's address).

**Reproduction (observed live):**
```
$ curl -s -X POST http://localhost:3011/api/checkout \
    -H 'content-type: application/json' -d '{"email":"victim@example.com"}'
{"url":"https://checkout.stripe.com/c/pay/cs_test_b1FHwpslUic6imLTFd3fS70fa06h6vzDd9RJONlA47A2k3Io..."}
```
Repeated calls each mint a new `cs_test_…` session with no throttle (HTTP 200 every time).

**Caveats that bound severity:** no money moves without a real card on Stripe's hosted page; no user data is exposed; Stripe itself imposes some upstream limits. But it is the only unauthenticated POST in the app that reaches a paid third party with **zero** rate limiting.

**Fix:** add `rateLimited("checkout:"+ip, …)` keyed on IP (this route has no email), and consider a lightweight abuse cap. Optionally require the caller to be signed in before creating a session.

---

### MEDIUM-2 — `/api/ila/report` rate-limits with a per-instance in-memory Map (the exact bug the July-5 audit migrated everything else away from), and has NO entitlement check
**File:** `app/api/ila/report/route.ts:12-25` — declares its own `const rateLog = new Map<string, number[]>()` and enforces the cap locally, instead of using the shared Postgres-backed `rateLimited()` in `lib/rateLimit.ts`. Confirmed the odd-one-out: all six other AI/alert routes import `@/lib/rateLimit`; this one does not.

**Scenario:** On Vercel every warm serverless instance holds its own `rateLog`, so the intended "5 reports / 5 min / email" cap is multiplied by the number of live instances. This route calls `notifyFailure()` → pages Aaron's Slack/Discord webhook. A single signed-in account can therefore fan out **alert spam to the owner's phone** well beyond the intended cap. Compounding it: the route performs **no `hasActiveSubscription` check** — any free signed-up account (not just paying subscribers) can trigger the owner pings.

**Reproduction:** requires a valid session token (returns `401` unauthenticated — confirmed live). The per-instance weakness is the same class of bug the shared store was introduced to kill (`lib/rateLimit.ts:3-9`); this route was simply missed in that migration.

**Fix:** replace the local Map with `await rateLimited(\`ila-report:${email}\`, 300_000, 5)`, and decide whether reporting should require an active subscription.

---

### LOW-3 — Subscription bypass rides on `NODE_ENV`; any non-production deploy exposes the paid Anthropic key to free accounts
**Files:** `ila`, `ila/reflect`, `scan-statement`, `scan-recap`, `scan-license`, `parse-payplan` — all gate with `if (!active && IS_PROD)` where `IS_PROD = process.env.NODE_ENV === "production"`.

**Scenario:** Correct for local dev. But any preview/staging/misconfigured deployment where `NODE_ENV` is not exactly `"production"` leaves every expensive Claude-Opus route open to any signed-in free account (rate-limited, but billable). Verified live: on this dev server the gate is inactive.

**Fix:** ensure preview/staging deploys set `NODE_ENV=production` (Vercel does this for Preview by default, but confirm), or gate on an explicit env flag rather than `NODE_ENV`.

---

### LOW-4 — CSP ships `'unsafe-inline'` in `script-src` in production
**File:** `next.config.mjs:17` — `script-src 'self' 'unsafe-inline'` (only `'unsafe-eval'` is dev-scoped). Verified in the served header. This weakens XSS defense-in-depth; an injected inline `<script>` would execute. Acceptable-common for Next.js but worth a nonce-based CSP given the app takes payments.

---

### LOW-5 — `/api/checkout` returns raw exception messages to the client
**File:** `app/api/checkout/route.ts:88-92` — `error: e instanceof Error ? e.message : …`. Surfaces raw Stripe/internal error strings to the caller. Minor information leak; prefer a generic message + server-side log (as `/api/portal` already does).

---

## CONFIRMED SOLID

- **Server-side session verification, single source of truth.** Every authed route resolves identity through `getSessionUser`/`getSessionEmail` (`lib/entitlement.ts:89-109`), which calls `supabase.auth.getUser(token)` server-side. No route trusts an email/user_id from the request body — `team`, `push/*`, `referral/code` all derive identity from the verified token (explicit comments at `push/subscribe:10-13`, `team:9`). **Confirmed `401` on missing AND garbage token across 14 routes.**
- **Owner routes triple-locked.** `owner/pulse` and `owner/ila`: `401` (no session) → `403` (`!isOwner`) → data only via service-role client (`getSupabaseAdmin`). Confirmed `401` unauthenticated; `isOwner` re-checked server-side, not trusted from client.
- **Crons fail CLOSED.** All three (`nudges`, `healthcheck`, `referral-rewards`) return `503` when `CRON_SECRET` is unset and `401` on a wrong bearer (`auth !== \`Bearer ${secret}\``). Confirmed `503` live for all three; the previous `if (secret){…}` fail-open shape is gone (comment at `nudges:60-68`).
- **Stripe webhook is hardened.** Verifies signature against the RAW body (`webhook:44-51`), `400` on forgery, `503` unconfigured, re-fetches live subscription state to be delivery-order-independent, staleness guard via `event_created`, and idempotent referral recording via a `referred_email` UNIQUE constraint.
- **Rate limiting on all six AI routes via the shared Postgres store** (`ila`, `ila/reflect`, `scan-statement`, `scan-recap`, `scan-license`, `parse-payplan`), auth-checked *before* the limiter, limiter *before* the paid Anthropic call. Confirmed imports; `lib/rateLimit.ts` does an atomic per-window increment with a safe in-memory fallback.
- **Input validation / injection posture.** Size caps enforced with `413` (`scan-*` `MAX_*_BYTES`, `parse-payplan` `MAX_CONTENT_BYTES`), `MAX_FILES`, media-type allowlist regex (`^data:image/(jpeg|png|webp)`), and hard sanitization of client-supplied chat blocks/memories (`ila:37-53,91-111` — type-checked, length-clipped, count-capped, tool-name allowlisted). Model outputs are coerced/clamped numerically, not trusted.
- **Entitlement fails closed.** `hasActiveSubscription` throw → routes set `active=false`; `/api/entitlement` returns `{active:false}` on any Stripe error (never grants on error).
- **No unauthenticated path to the AI bill.** Every Anthropic-spending route requires a valid session; in prod also an active subscription. **No ElevenLabs/TTS API route exists** — voice is pre-generated static clips in `/public/demo` (`app/demo/page.tsx:10`), so there is no runtime TTS cost surface.
- **Malformed bodies don't 500.** `req.json().catch(() => ({}))` everywhere; probed `NOTJSON{` → `401` (ila, auth-first) / `200` (checkout, empty-body path). No stack traces or `500`s leaked.
- **`supabaseAdmin` service-role key** is read from a non-`NEXT_PUBLIC_` env and the module is `server-only`; never reaches the browser bundle.
- **Platform headers present** (verified live): HSTS w/ preload, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` locking camera/mic/geo/payment.

---

## Probe log (live, dev server :3011)

| Route | Unauth | Bad token | Notes |
|---|---|---|---|
| POST /api/ila, /ila/reflect, /ila/report | 401 | 401 | auth-first |
| POST /api/parse-payplan, /scan-statement, /scan-recap, /scan-license | 401 | — | |
| POST /api/owner/pulse, /owner/ila | 401 | 401 | triple-lock |
| POST /api/team, /portal, /push/subscribe, /push/unsubscribe | 401 | — | |
| GET /api/referral/code | 401 | — | |
| GET /api/cron/{nudges,healthcheck,referral-rewards} | 503 | 503 (bad secret) | fail-closed (secret unset) |
| POST /api/checkout | **200** | n/a | **no auth, no rate limit — MEDIUM-1** |
| POST /api/entitlement | 200 `{active:false}` | — | by design |
