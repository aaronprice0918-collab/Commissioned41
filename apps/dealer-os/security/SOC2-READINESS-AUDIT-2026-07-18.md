# SOC 2 Readiness Audit — Dealer Mission OS (commissioned41-os)

**Date:** 2026-07-18
**Scope:** `commissioned41-os` repo (dealer product) + its prod Supabase (`wwwibdjgabicenvpmivy`),
plus org-level infra observations (5 Supabase projects; MissionOS Lite DB).
**Method:** 6 parallel specialist code auditors (tenant isolation, auth/authz, secrets/supply-chain,
PII/privacy, injection/AI-safety, billing/ops) + live Supabase policy/grant verification + Stripe/Vercel
config checks. Read-only; no code or data modified.

> **Note on SOC 2:** This is a *technical readiness* audit mapped to the Trust Services Criteria
> (Security/Common Criteria, Confidentiality, Privacy, Availability, Processing Integrity). SOC 2
> *certification* additionally requires written policies, an auditor, and an evidence window (Type II =
> 3–12 months). The goal here is to close the technical gaps that would fail an audit on day one.

## Overall posture

**Strong foundation, one critical data-tier gap.** The application layer is well-built: consistent
session-derived auth, org-scoped queries everywhere, closed IDOR on sensitive documents, verified
webhooks with replay guards, no SQLi/XSS, secrets kept server-side, MFA implemented, and real
governance docs already in `security/`. The headline problem is that the **database RLS policy is far
more permissive than the server-side authorization it is supposed to back up**, and the browser talks
to the database directly — so the server controls can be bypassed. Fix that first; the rest is standard
hardening.

---

## CRITICAL

### C-1 — `app_store` RLS lets any signed-in user bypass all server-side authz (VERIFIED on prod)
**Where:** `supabase/migrations/0004_app_multitenant.sql:58-61`; reachable because the browser
authenticates directly to Supabase (`components/AuthProvider.tsx` `signInWithPassword`,
`lib/supabaseBrowser.ts`, public anon key in the bundle).

**Verified against prod (`wwwibdjgabicenvpmivy`):**
- Policy `app_store_tenant` = `FOR ALL TO authenticated USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id())` — tenant-scoped only, **no key or role restriction**.
- `current_org_id()` = `select org_id from user_profiles where id = auth.uid()` — returns the caller's
  own org.
- `authenticated` role holds `SELECT/INSERT/UPDATE/DELETE` on `app_store`.
- Org `00000000-…-0001` (Kennesaw) has **19 users** across roles **Sales, BDC, F&I, Manager, Admin**,
  all sharing that one org, which holds keys `payplans`, `deals`, `crmLeads`, `conversations`,
  `messages`, `closedMonths`, `goals`, `telemetry`, `team`.

**Exploit:** A Sales rep (lowest role) uses the public anon key + their own JWT against
`${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/app_store?key=eq.<key>`:
- `key=eq.payplans` → **every employee's compensation** (server restricts to self).
- `key=eq.deals` / `crmLeads` / `messages` → **all customers' unredacted PII** across all 19 reps
  (defeats `filterForUser` redaction in `app/api/store/[key]/route.ts`).
- `key=eq.telemetry` → a server-only key never meant to be client-reachable.
- `UPDATE`/`DELETE` any key → wipe `deals`, rewrite `closedMonths`/`goals`/`payplans` (all admin-only
  via `lib/access.ts` `canWrite`) — bypassing the entire write matrix.

This collapses the server's allowlist + role matrix + PII redaction to "any authenticated user, any key,
read+write, within their org."

**Fix (staging-first — never edit prod RLS live):**
- Preferred: **revoke direct table access** for `authenticated`/`anon` on `app_store` and force all
  access through the service-role server routes (the app already reads via `/api/store`). i.e.
  `revoke all on public.app_store from authenticated, anon;` and drop the permissive policy.
- Or: tighten the policy to encode the same rules (exclude server-only keys; gate writes by role via a
  `current_role()` SECURITY DEFINER helper). More complex; easy to get wrong.
- Prove on `COMMISSIONED41-staging` first, confirm the app still works end-to-end, then apply to prod.

**SOC 2:** CC6.1 (logical access — role boundary not enforced at the data tier), CC6.3 (least
privilege), Confidentiality C1.1/C1.2 (comp + customer PII exposed across roles).

---

## HIGH

### H-1 — Real customer PII + employee comp committed to the git repo
**Where:** `recovery-2026-07-09/*.json`, `snapshot-deals_backup*.json`, `readback-deals.json`,
`snapshot-closedMonths.json`, `work_import_deals.mjs` (all git-tracked).
62+ real deals with customer last names, front/back gross, reserve, lender, and named salespeople/F&I
are in version control and full history. `.gitignore` excludes `/data/*.json` for exactly this reason,
but these recovery/import files bypass it. Repo is **private** (→ HIGH, not CRITICAL), but the data is
in every clone, every collaborator's laptop, and all history, outside tenant isolation and retention.
**Fix:** `git rm` the files; purge history (git-filter-repo/BFG); relocate recovery artifacts to the
gitignored `/data`; add a pre-commit/secret-scan guard for customer-data JSON. Treat as a minor internal
data-handling incident (log it — good SOC 2 evidence).
**SOC 2:** C1.1/C1.2, P4.x. GDPR/CCPA storage-limitation.

### H-2 — Driver's-license & insurance images retained indefinitely (no cleanup)
**Where:** `app/api/deal-docs/route.ts` (bucket `deal-docs`) vs. `app/api/cron/jacket-cleanup/route.ts`
(jackets get a 90-day delete cron; `deal-docs` gets none).
DL images (license #, DOB, address, photo) and insurance cards accumulate forever, unlike the
SSN-bearing jacket PDFs which are bounded. Contradicts the product's own retention philosophy.
**Fix:** Add a `deal-docs` retention cron mirroring `jacket-cleanup`; delete a lead's images when the
lead/deal is deleted.
**SOC 2:** P4.2 (retention), C1.2 (disposal).

### H-3 — No error monitoring, alerting, or security-event logging
**Where:** no Sentry/Datadog/OTel dependency; observability is `console.*` → Vercel logs only. Failed
auth (401), entitlement denials (402), and webhook signature failures produce no alert and often no log.
A credential-stuffing run or paywall probe is invisible in real time.
**Fix:** Add APM + alerting (Sentry or Vercel); emit structured security events for failed auth,
entitlement denials, signature failures, and 403s; wire one alert channel.
**SOC 2:** CC7.2 (monitoring), Availability A1.2.

### H-4 — CI does not gate production deploys
**Where:** `.github/workflows/ci.yml` runs only `npm run build` — not `npm run lint`, `npm test`, or
`tsc --noEmit` (all exist). Vercel deploys to prod on push to `main` independent of CI; no branch
protection. The tests that guard money math and `decideEntitlement` never run in the pipeline.
**Fix:** Add lint/test/typecheck to CI; enable branch protection on `main` requiring the check; gate the
Vercel prod deploy on CI success.
**SOC 2:** CC8.1 (change management).

### H-5 — EILA financial write-tools execute with no confirmation, with untrusted data in context
**Where:** `app/api/ai/crm/route.ts` — context built from lead/deal fields (`buildSnapshot`,
`leadToContext`) that can include customer-controlled values (imports/web-leads); write tools
`update_deal`/`update_lead`/`set_goals`/`service_update`/`parts_update` execute immediately (unlike
`close_month`/`restore_backup`/`text_customer`, which require `confirm:true`).
A crafted field (e.g. a customer "name" carrying an instruction) could induce a tool call during a
routine manager query — e.g. zeroing a deal's gross, which mis-drives commission. Blast radius is
bounded (org-pinned, role-checked, args whitelisted) — an injection can't cross tenants or exceed the
caller's role — but it can silently mutate the caller's own store's money.
**Fix:** Require `confirm:true` (preview-then-commit) on all record/money-mutating tools; delimit
untrusted data blocks in the prompt as data-not-instructions; strip control phrases from customer
fields; log every tool write with actor + before/after.
**SOC 2:** CC6.8, PI1.2/PI1.3, CC7.1.

---

## MEDIUM

- **M-1 — No security headers.** `next.config.mjs` empty, no `middleware.ts`, `vercel.json` cron-only.
  Missing CSP, `X-Frame-Options`/`frame-ancestors` (paywalled app is clickjackable),
  `X-Content-Type-Options`, `Referrer-Policy`, explicit HSTS. *Fix:* add a `headers()` block. CC6.6/6.7.
- **M-2 — Internal/DB error strings leaked to clients** (`store/[key]:68,165`, `users:107`,
  `checkout:65`, AI routes) + **email enumeration** on signup (`provision.ts:35`). The Stripe webhook
  (`webhook:94`) is the correct sanitized pattern — apply it everywhere. CC6.1, PI1.x.
- **M-3 — No rate limiting** on `checkout` (unauth → Stripe session spam), `billing`, `signup`,
  `sms/send` (Twilio cost/TCPA), `users`, `store/[key]` writes. The `lib/rateLimit.ts` helper exists and
  is used elsewhere — just wire it in. CC6.1, A1.1.
- **M-4 — No server-side numeric/schema validation on financial writes** through the KV store
  (`store/[key]/route.ts` writes `body` verbatim for money keys). `frontGross:"1e9"`/`NaN`/negatives can
  be persisted and flow into the pay engine. The AI path already guards with `finiteOrUndef`; the screen
  path does not. *Fix:* Zod-validate money keys on write. PI1.2/PI1.3.
- **M-5 — No customer-level right-to-delete/erasure.** Only per-deal delete exists; no sweep across all
  keys + both storage buckets. `/privacy` promises erasure support that no code backs. P5.2/P6.x, CCPA/GDPR.
- **M-6 — Weak data minimization to Anthropic.** `jacket-scan` sends full SSN/income pages just to
  classify page types; ILA injects the whole customer roster (names/phones/emails) even when not needed.
  Not stored/trained by Anthropic (correctly disclosed), but more PII leaves than the task requires.
  *Fix:* redact/downscale for classification; scope the roster to the query. Formalize the subprocessor/DPA
  list (add Twilio + Resend). P3, C1.1.
- **M-7 — Cross-tenant "EILA Brain" de-identification is behavioral, not structural.**
  `lib/ila-brain.ts` / `lib/ila-user-memory.ts` distill "lessons" from one store's chats into a shared
  brain injected into every store's prompt; the only barrier to leaking names/prices/store IDs is the
  reflection model being told not to. *Fix:* deterministic PII/entity scrub before `saveBrainLessons`, or
  per-tenant brain promoted to global only after review. C1.1/C1.2.
- **M-8 — Accounts force-confirm email** (`provision.ts:30`, `users:75` `email_confirm:true`) with no
  proof of ownership. Latent for self-serve signup (gated), live for admin-created staff. CC6.2.
- **M-9 — "Your Deal" capability secret travels in the URL path** (`your-deal` / `lib/yourDeal.ts`
  `${orgId}.${secret}`) — leaks via history, `Referer`, proxy logs. Route is otherwise well-designed
  (token-as-credential, rate-limited, revocable). *Fix:* deliver as `#fragment`; `Referrer-Policy:
  no-referrer`. CC6.1/CC6.6.
- **M-10 — Infra/Supabase advisories (verified via linter):**
  - Prod `organizations`: RLS enabled, **no policy** (RLS not actually enforcing; relies on app code).
  - `current_org_id()` is SECURITY DEFINER **executable by anon** — lock down / confirm intentional.
  - **MissionOS Lite DB** (`fhqxefvpygpxregmpcow`): 7 tables RLS-enabled with **no policies**, including
    **`lite_plaid_items`** (Plaid bank-linkage tokens) — sensitive financial data with no row policy.
    (Separate repo; flagged because you asked for the whole company.)
  - **Leaked-password protection disabled** on the Lite + COMMISSIONED41 auth (enable HIBP check).
- **M-11 — Config drift / project sprawl.** `DEPLOYMENT.md:66,80` names `djnvkypjswtwqzuysmxg` as prod,
  but the live dealer DB is `wwwibdjgabicenvpmivy` (per `C41_MEMORY.md`). **5 Supabase projects** exist
  for the org. Auditors fail change-management on "which system is prod?" ambiguity. *Fix:* correct the
  doc; label/retire stale projects; one canonical prod + staging. CC8.1.

---

## LOW / hardening

- **L-1 — Entitlement gate fails OPEN on DB error** (`billing.ts:99-101` `check_failed_open`) and
  grandfathers orgs with no `created_at`. Deliberate availability tradeoff; blast radius is billing only.
  *Fix:* log/alert every fail-open decision; record as an accepted risk in `RISK-ASSESSMENT.md`.
- **L-2 — `checkout` trusts `body.orgId`/`email` when unauthenticated** (`checkout:32`) — signed-in
  callers are correctly overridden. Worst case: attacker *pays* to activate a victim org (a gift), no
  bypass. *Fix:* require a session once signups gate behind auth.
- **L-3 — Cron auth uses non-constant-time compare** (`cron/*` `!==`). Use `crypto.timingSafeEqual`
  (webhooks already do). CC6.1.
- **L-4 — Weak password policy** (min 8, no complexity/breach check). Raise to ≥12 + enable Supabase
  leaked-password protection. CC6.2.
- **L-5 — `user_profiles.org_id` nullable + `|| DEFAULT_ORG_ID` fail-open** on privileged routes
  (`users:25`, `ai/import:44`). A null-org admin silently becomes a founding-store admin. *Fix:*
  `set not null` + fail-closed. CC6.3.
- **L-6 — `checkout` success/cancel URL built from the `Origin` header** (`checkout:23`). Build from a
  server-side allowlist (`NEXT_PUBLIC_APP_URL`). CC6.1.
- **L-7 — Supply chain:** transitive `postcss <8.5.10` XSS via `next` (patch via `npm update next`; do
  NOT take the suggested `next@9` downgrade); pin Stripe `apiVersion` in `lib/stripe.ts`; add
  `engines.node` + `.nvmrc`. `xlsx`→`@e965/xlsx` fork is a good deliberate choice. CC7.1.
- **L-8 — Logging error bodies** (`jacket-scan:107`, telemetry 300-char messages) could carry PII
  fragments; redact. Signed-URL bearer links (120–300s) are appropriately short.

---

## What's already correct (evidence FOR the auditor — preserve)

- **Tenant isolation in app code** is consistent: org resolved from the verified session's
  `user_profiles`, never from client input; every `app_store` query carries `.eq("org_id", orgId)`;
  server-only keys (`billing`, `groupConfig`, `commsConfig`) excluded from `allowedKeys` and written by
  no route. (CC6.1)
- **Document IDOR closed:** `deal-docs`/`jacket-file` enforce org-prefix path + per-deal/per-lead
  ownership (`lib/docAuth.ts`), private buckets, 120–300s signed URLs. (CC6.1)
- **Webhooks verified:** Stripe `constructEvent` on the raw body + live refetch + ordering guard;
  Twilio HMAC with `timingSafeEqual`. A forged request cannot activate a store or forge an SMS. (CC6.6, PI1.x)
- **Paywall can't be forged:** `billing` row is service-role-write-only; founding store is a hardcoded
  constant, not client input; `past_due` correctly denied. (CC6.1)
- **Secrets hygiene:** service-role key server-only; no secret is `NEXT_PUBLIC_`; no secret in a client
  component; `.env.local` never tracked; lockfile present. (CC6.1)
- **CAS (compare-and-swap)** on store writes prevents lost updates; **money guards** (`finiteOrUndef`)
  on the AI path. (PI1.x)
- **MFA (TOTP)** implemented; **cron routes fail-closed** without `CRON_SECRET`; **telemetry**
  authenticated (anti prompt-injection). (CC6.1)
- **Governance docs** exist: `SECURITY-POLICY.md`, `RISK-ASSESSMENT.md` (FTC Safeguards-aligned),
  `INCIDENT-RESPONSE.md`, `RUNBOOK-KEYS-MFA.md`. (CC1/CC5/CC7.3/CC7.4)
- **Privacy:** accurate `/privacy` with subprocessor disclosure; TCPA consent + STOP handling; jacket
  90-day retention cron; no SSN stored as a structured field; no SQLi; no XSS (`escapeHtml` on the one
  print path). (Privacy, PI1.x)

---

## Prioritized remediation plan

**Do first (before any SOC 2 attestation):**
1. **C-1** — lock down `app_store` RLS (revoke direct `authenticated`/`anon` access; force through server
   routes). Prove on staging first, then prod. *This is the one true critical.*
2. **H-1** — purge committed customer/comp data + history; add a secret/data-scan guard.
3. **H-4** — make CI run lint/test/tsc and gate the prod deploy (branch protection).
4. **H-3** — add error monitoring + security-event logging with alerting.

**Next:**
5. **H-2** deal-docs retention cron · **H-5** confirm-to-commit on AI write tools · **M-4** money-field
   validation on the screen write path.
6. **M-1** security headers · **M-2** sanitize client errors · **M-3** rate-limit checkout/signup/sms.
7. **M-10** Lite `lite_plaid_items` + the RLS-no-policy tables; enable leaked-password protection.
8. **M-11** fix `DEPLOYMENT.md` + label/retire stale Supabase projects.

**Then:** M-5 erasure, M-6 AI data minimization + DPA/subprocessor list, M-7 brain scrub, M-8/M-9, and
the LOW hardening items.

**Non-code (needed for actual SOC 2 certification):** written policies (several exist), an auditor
engagement, an evidence-collection window, vendor/subprocessor management, access reviews, and a
formal risk assessment sign-off.
