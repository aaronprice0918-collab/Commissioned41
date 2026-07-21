# Commissioned 41, LLC — Information Security Policy

**Version 1.0 · Adopted July 6, 2026 · Owner / Qualified Individual: Aaron Price (GLBA Safeguards Rule §314.4(a))**
**Applies to:** Dealer Mission OS (missionos.commissioned41.com), MissionOS Lite / ILA, MissionOS Finance, and all company systems and credentials.

This policy is written to be TRUE, not impressive. Every control listed here either exists today or is marked ☐ TODO with an owner. Review at least annually and whenever the architecture changes.

## 1. Why this exists

Our customers are car dealerships and their employees. Deal records contain **nonpublic personal information (NPI)** under the Gramm-Leach-Bliley Act — consumer names, addresses, phone numbers, lenders, and financing figures — which makes our dealership customers "financial institutions" under the FTC Safeguards Rule (16 CFR Part 314) and makes Commissioned 41 their **service provider**, contractually required to maintain safeguards appropriate to that data.

## 2. Data we hold, and where

| Data | System | Notes |
|---|---|---|
| Dealer operational data: deals, leads, comp plans, team, goals (incl. consumer names/contact/finance figures) | Supabase Postgres (`app_store` JSONB, org-scoped; `user_profiles`) | Multi-tenant; org isolation enforced in the API layer |
| Lite user data: profile, pay plan, deals (incl. consumer names/phones from recaps) | Supabase Postgres (`lite_state`, RLS: `auth.uid() = user_id`, verified live July 4, 2026) | One row per user |
| Auth credentials | Supabase Auth (passwords hashed by Supabase; we never see them) | No in-app MFA yet — ☐ TODO (roadmap) |
| Billing | Stripe | We never store card numbers |
| Document/photo scans (deal recaps, driver's licenses, insurance cards, pay plans) | **Not stored.** Processed transiently: image → Anthropic API → extracted fields → discarded | Extracted fields are stored as part of the deal/plan |
| Voice audio (dealer app ILA voice) | ElevenLabs (generation only) | No customer audio recorded |
| Logs | Vercel (runtime logs), Supabase logs | No card or password data in logs |

## 3. Access control

- **Production access:** Aaron Price only. There are no other employees.
- **AI agents (Claude sessions) operating on Aaron's machines can access production credentials in local env files.** This is a deliberate, acknowledged tradeoff for a solo operation: agent access is used for development, debugging, and — with explicit direction — production support (e.g., the July 6 pay-plan repair, where the affected row was backed up before modification). Rules: agents act only under Aaron's direction in-session; production data reads are minimized to the task; production writes require an explicit instruction and a pre-change backup. ☐ TODO: move service-role usage behind dedicated, logged admin scripts.
- **Least privilege:** browser/client code uses publishable/anon keys only; service-role keys are server-side (Vercel env) and local admin use only.
- **In-app roles:** owner/Admin/Manager/F&I/Sales/BDC permissions enforced server-side (see `lib/access.ts`); pay data is privacy-scoped (a rep sees only their own).
- **Access review:** quarterly — list every human, agent, and integration with production access; remove anything unneeded. First review due **October 6, 2026**.

## 4. Credential & secrets handling

- All provider accounts (GitHub, Vercel, Supabase, Stripe, Anthropic, ElevenLabs, domain registrar, email) **have MFA enabled — verified across ALL accounts July 7, 2026**: email/Google 2-Step (since 2021), GitHub (passkey + GitHub Mobile), Stripe (Google SSO + authenticator app), and Supabase/Vercel/Anthropic/ElevenLabs/the domain registrar (Vercel Domains) all via Google SSO, inheriting the Google 2-Step. See `security/RUNBOOK-KEYS-MFA.md`.
- Secrets live in Vercel environment variables (production) and 1Password or equivalent (master copies). `.env.local` files are gitignored and hold **development** secrets; production service-role keys should not live long-term on laptops. ☐ TODO: rotate both Supabase service-role keys (dealer + lite) and remove from laptop env files — see runbook.
- Rotation triggers: on any suspected exposure, on any tooling/vendor incident, and at least annually.
- No secrets in git history, client bundles, or logs. (`NEXT_PUBLIC_*` = publishable by design.)

## 5. Technical safeguards

- **Encryption in transit:** TLS everywhere (Vercel-terminated HTTPS).
- **Encryption at rest:** Supabase (AES-256 managed), Stripe, Vercel.
- **Tenant isolation:** every store is its own org; lite rows are per-user RLS. Never test tenant-isolation changes against production data (standing rule since June 2026).
- **Endpoint gating:** AI endpoints require authenticated, entitled callers and are rate-limited (shared-store rate limits, not per-instance).
- **Device security:** company laptops require full-disk encryption (FileVault) + OS auto-updates + screen lock. ☐ TODO: verify FileVault on the primary machine.
- **Backups:** Supabase automated backups. ☐ TODO: verify point-in-time recovery tier and perform one test restore; document restore time.
- **Dependency hygiene:** `npm audit` on significant changes; Vercel/Next.js security updates applied promptly.

## 6. AI/LLM data handling

- Customer content (deal recaps, license scans, pay plans, ILA conversations) is sent to **Anthropic's API** to power extraction and the ILA assistant. Under Anthropic's commercial API terms this data is not used to train models. Images are processed transiently and not persisted by us.
- Lite's shared coaching playbook stores lessons **stripped of names, employers, and personal details** before leaving a user's account.
- ☐ TODO (growth): Anthropic zero-data-retention arrangement; add AI-processing disclosure to dealer onboarding.

## 7. Vendors (subprocessors)

Supabase (database/auth) · Vercel (hosting) · Anthropic (AI) · Stripe (payments) · ElevenLabs (voice synthesis, dealer app). Each processes data under its commercial terms/DPA. ☐ TODO: record DPA acceptance dates for each; review the list quarterly and update the privacy policies when it changes.

## 8. Retention & disposal

- Operational data: retained while the account/org is active; deleted on verified request within 30 days.
- Scan images: never stored (transient processing only).
- Departed dealership employees: deactivated by the dealership's admin; org data belongs to the dealership (controller); we act as processor.

## 9. Incident response

See `security/INCIDENT-RESPONSE.md`. Any suspected security event is handled per that plan, including the FTC's 30-day notification requirement for breaches affecting 500+ consumers and state breach-notification laws.

## 10. Risk assessment

See `security/RISK-ASSESSMENT.md` — the written risk assessment required by Safeguards Rule §314.4(b). Reassess annually or upon material change (new vendor, new data type, first employee, SOC 2 engagement).

## 11. Change management

Money-math and tenant-isolation changes require passing test suites before deploy (`lib/pay*.test.ts`, `lib/payAudit.test.ts`, lite `kennesawAudit`). Production deploys happen only from `main`. Schema changes are never improvised against production.
