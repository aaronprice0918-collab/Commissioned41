# PROD-AUDIT — lite.commissioned41.com

**Date:** 2026-07-05 · **Method:** read-only curl probes from this Mac (no signups, no writes, no auth tokens used).
Every claim below is backed by the exact command and the observed response. Expected behavior taken from the repo at `/Users/pricefamily/missionos-lite`.

**Result: 46/46 checks PASS. 0 mismatches against code. 1 design note (entitlement, see §3).**

---

## 1. Security headers

Expected (from `next.config.mjs` `headers()` — applies to `/:path*`, i.e. every route incl. APIs): CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, HSTS, Permissions-Policy. Production CSP must NOT contain `'unsafe-eval'` (dev-only flag).

```
curl -sS -D - -o /dev/null https://lite.commissioned41.com/
```

Observed on `/`:

```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://fhqxefvpygpxregmpcow.supabase.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
```

- ✅ All 6 headers present, values byte-match `next.config.mjs`.
- ✅ No `'unsafe-eval'` in script-src → confirms production build serving.
- ✅ Same 4 core headers (CSP/HSTS/XFO/nosniff) confirmed present on ALL of `/demo /guide /subscribe /privacy /terms /money` (4/4 grep count per page).
- ✅ API responses carry them too — checked on the `POST /api/ila` 401 response: CSP + HSTS + XFO + nosniff all present (4/4).

## 2. Public pages

```
curl -sS -D h.txt -o body.html -w "%{http_code} %{time_total}s" https://lite.commissioned41.com<path>
```

| Path | Status | Time | Content evidence |
|---|---|---|---|
| `/` | 200 | 0.171s | `<title>ILA</title>` |
| `/demo` | 200 | 0.151s | `<title>ILA</title>`; tour is client-rendered — audio srcs built at runtime as `` `/demo/${step.id}.mp3` `` (`app/demo/page.tsx:274`), so mp3 names correctly absent from SSR HTML |
| `/guide` | 200 | 0.191s | `<title>Get ILA on Your Phone — Kennesaw Mazda</title>` + h1 text found (matches `app/guide/page.tsx:5`) |
| `/subscribe` | 200 | 0.196s | body contains `$19.99`, `Subscribe`, `checkout` |
| `/privacy` | 200 | 0.161s | `Privacy Policy` h1 (matches `app/privacy/page.tsx`) |
| `/terms` | 200 | 0.147s | `Terms of Service` h1 (matches `app/terms/page.tsx`) |
| `/money` | 200 | 0.142s | contains the `animate-pulse` loading shell |

**/money logged-out behavior — matches code exactly.** `app/money/page.tsx` is `"use client"`; the redirect to `/` happens in a `useEffect` via `router.replace("/")` when no profile exists. So the server correctly returns HTTP 200 with the pulse-placeholder shell (observed), and the redirect is client-side. A server-side 3xx here would have been the mismatch; there is none. ✅ 7/7 pages pass.

## 3. API routes — unauthenticated rejection

All probed with `curl -sS -X <METHOD> -H "content-type: application/json" -d '{}' -w "%{http_code} %{time_total}"` (no Authorization header), except where noted.

| Route | Expected (code) | Observed | Time | Body |
|---|---|---|---|---|
| `POST /api/ila` | 401 (`route.ts:58`) | **401** ✅ | 0.305s | `{"error":"Sign in required."}` |
| `POST /api/ila/reflect` | 401 (`:30`) | **401** ✅ | 0.374s | `{"error":"Sign in required."}` |
| `POST /api/entitlement` | 200 `{active:false}` — by design, see note | **200** ✅ | 0.133s | `{"active":false,"reason":"not-signed-in"}` |
| `POST /api/parse-payplan` | 401 (`:64`) | **401** ✅ | 0.120s | `{"error":"Sign in required."}` |
| `POST /api/scan-license` | 401 (`:49`) | **401** ✅ | 0.426s | `{"error":"Sign in required."}` |
| `POST /api/scan-recap` | 401 (`:63`) | **401** ✅ | 0.337s | `{"error":"Sign in required."}` |
| `POST /api/scan-statement` | 401 (`:62`) | **401** ✅ | 0.349s | `{"error":"Sign in required."}` |
| `POST /api/checkout` (body `{"invite":"definitely-not-a-real-code-audit-probe"}`) | 400 invalid-invite (`:37`) | **400** ✅ | 0.130s | `{"error":"That invite code isn't valid."}` |
| `POST /api/portal` | 401 (`:18`) | **401** ✅ | 0.116s | `{"error":"Sign in required."}` |
| `POST /api/push/subscribe` | 401 (`:14`) | **401** ✅ | 0.131s | `{"error":"Sign in first."}` |
| `POST /api/push/unsubscribe` | 401 (`:11`) | **401** ✅ | 0.116s | `{"error":"Sign in first."}` |
| `GET /api/referral/code` | 401 (`:22`) | **401** ✅ | 0.119s | `{"error":"Sign in first."}` |
| `POST /api/team` | 401 (`:17`) | **401** ✅ | 0.130s | `{"error":"Sign in first."}` |
| `POST /api/owner/pulse` | 401 (`:17`) | **401** ✅ | 0.109s | `{"error":"Sign in required."}` |
| `POST /api/owner/ila` | 401 (`:24`) | **401** ✅ | 0.174s | `{"error":"Sign in required."}` |
| `POST /api/stripe/webhook` (unsigned JSON) | 400 invalid signature (`:50`) | **400** ✅ | 0.139s | `{"error":"Invalid signature."}` |
| `GET /api/cron/nudges` (no bearer) | 401 (`:69`) | **401** ✅ | 0.399s | `{"error":"Unauthorized"}` |
| `GET /api/cron/healthcheck` (no bearer) | 401 (`:73`) | **401** ✅ | 0.225s | `{"error":"Unauthorized"}` |
| `GET /api/cron/referral-rewards` (no bearer) | 401 (`:32`) | **401** ✅ | 0.136s | `{"error":"Unauthorized"}` |

No route returned 404, 500, or an unexpected 200. Cron routes returning 401 (not 503 "Cron not configured") also proves **CRON_SECRET is set in production** — the fail-closed gate is live.

**Design note (not a bug):** `/api/entitlement` intentionally answers 200 with `{"active":false}` when unauthenticated — it is a yes/no entitlement query, coded to fail closed (`app/api/entitlement/route.ts:27`). Observed behavior matches the code exactly and grants nothing. Likewise `/api/checkout` requires no sign-in by design (anonymous buyers); the invalid-invite probe was used so the check proved rejection without creating a Stripe session.

### Negative-auth extras
```
curl -X POST -H "authorization: Bearer forged.invalid.token" .../api/ila   → 401 (0.700s) ✅ forged Supabase token rejected
curl -H "authorization: Bearer wrong-cron-secret" .../api/cron/nudges     → 401 (0.281s) ✅ wrong cron secret rejected
curl .../api/does-not-exist                                               → 404 ✅ (baseline: real routes never 404'd)
```

### AI-route rejection latency
All Anthropic-backed routes (`/api/ila`, `/api/ila/reflect`, `/api/parse-payplan`, `/api/scan-*`) rejected in **0.12–0.43s** — the auth gate fires before any body read or Anthropic call, exactly as the code orders the checks (e.g. `parse-payplan/route.ts` comment "before reading the body or spending the Anthropic key"). No token spend on unauthenticated traffic. ✅

## 4. Demo tour media

`curl -sSI https://lite.commissioned41.com/demo/<file>` (HEAD):

| File | Status | Content-Type | Bytes |
|---|---|---|---|
| 1-intro.mp3 | 200 | audio/mpeg | 47,691 |
| 2-setup.mp3 | 200 | audio/mpeg | 51,035 |
| 3-payplan.mp3 | 200 | audio/mpeg | 57,722 |
| 4-dashboard.mp3 | 200 | audio/mpeg | 64,409 |
| 5-logdeal.mp3 | 200 | audio/mpeg | 50,199 |
| 6-followup.mp3 | 200 | audio/mpeg | 56,050 |
| 7-chat.mp3 | 200 | audio/mpeg | 53,960 |
| 8-money.mp3 | 200 | audio/mpeg | 110,385 |
| 9-close.mp3 | 200 | audio/mpeg | 40,586 |
| ILA-Spot.mp4 | 200 | video/mp4 | 4,515,123 |

✅ 10/10, all non-trivial sizes, correct MIME types. File set matches the 9 step ids in `app/demo/page.tsx:50-199` (`1-intro` … `9-close`). Note: `ILA-Spot.mp4` (and `ILA-Tour.mp4`) exist in `public/demo/` but are not referenced by any app code — served as static assets only.

---

## Verdict

**PASS — 46/46. Zero mismatches between production behavior and the code.** Security headers live everywhere (pages + APIs), production CSP is the strict variant, every public page serves its expected content, every API rejects unauthenticated traffic exactly as coded (fast, pre-spend), cron and webhook gates are armed with their secrets, and all demo media is live.
