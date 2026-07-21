# Commissioned 41, LLC — Written Risk Assessment

**Version 1.0 · July 6, 2026 · Prepared for the Qualified Individual: Aaron Price**
Satisfies FTC Safeguards Rule §314.4(b) (written risk assessment). Reassess annually or on material change. Scoring: Likelihood × Impact, 1–3 each (High = 6–9, Medium = 3–4, Low = 1–2).

## Crown-jewel data
1. Consumer NPI inside dealer deal records (names, contact, lender, finance figures) — GLBA-covered.
2. Employee compensation data (pay plans, commissions, paychecks).
3. Auth credentials and API keys.
4. Transient scan images (driver's licenses, deal recaps) while in flight.

## Risks, ranked

| # | Risk | L | I | Score | Current mitigation | Action |
|---|---|---|---|---|---|---|
| 1 | **Laptop compromise exposes production service-role keys** (`.env.local` holds Supabase service keys with full read/write to all customer data; any process or agent on the machine can use them) | 2 | 3 | **6 HIGH** | Keys gitignored; single-user machine | **Rotate both service keys; move to Vercel env + password manager; verify FileVault; keep only dev-tier keys locally** |
| 2 | **Provider account takeover** (GitHub/Vercel/Supabase/Stripe/email) — email is the root of password resets | 1 | 3 | **3 MED** (was 6 HIGH; mitigated July 7, 2026) | **MFA enabled on all core accounts:** email/Google 2-Step (since 2021, the reset root), GitHub (passkey + GitHub Mobile), Supabase/Vercel/Anthropic (Google SSO → inherits the 2-Step), Stripe (Google SSO + authenticator app) | MFA verified on ALL provider accounts July 7, 2026 (domain registrar = Vercel Domains + ElevenLabs both via Google SSO); keep authenticator/hardware over SMS going forward |
| 3 | **Tenant isolation defect** leaks one dealership's data to another | 1 | 3 | **3 MED** | Org-scoped storage; isolation tested before the June 2026 migration; standing rule: never test isolation on prod | Add automated cross-tenant regression tests to CI; re-verify on every storage-layer change |
| 4 | **No in-app MFA for dealer users** — a phished dealership password exposes that org's NPI; Safeguards expects MFA for access to customer info | 2 | 2 | **4 MED** | Server-side role enforcement; per-org blast radius | Roadmap: TOTP/email-code MFA before selling beyond Kennesaw; document as a known gap in sales conversations |
| 5 | **Third-party (subprocessor) breach** — Supabase/Vercel/Anthropic/Stripe/ElevenLabs | 1 | 3 | **3 MED** | Reputable vendors, encrypted at rest, DPAs available | Record DPA acceptance; subscribe to vendor status/security notices; list subprocessors publicly |
| 6 | **PII in AI processing** — recap/license images and ILA context flow through Anthropic | 1 | 2 | **2 LOW** | Commercial API terms (no training on API data); images transient, never stored by us | Zero-retention arrangement at growth stage; keep disclosures current in both privacy policies |
| 7 | **Solo-operator continuity** — one person holds all access; loss of access (or of Aaron's availability) stalls incident response and customer support | 2 | 2 | **4 MED** | Documented runbooks in `security/`; memory/process logs in repo | Password-manager emergency kit + designated emergency contact with sealed access instructions |
| 8 | **Payment data** | 1 | 2 | **2 LOW** | Fully delegated to Stripe; no card data touches our systems | None beyond Stripe account MFA (risk #2) |
| 9 | **Data loss** (bad deploy, bad migration, accidental deletion) | 2 | 2 | **4 MED** | Supabase automated backups; pre-change backups for manual data operations (practiced July 6); no improvised prod schema changes | Verify PITR tier; one test restore, documented |
| 10 | **Phishing/social engineering of dealership staff** leading to credential sharing | 2 | 2 | **4 MED** | Role scoping limits blast radius | Add security-basics note to dealer onboarding; in-app MFA (risk #4) closes most of this |

## Acceptance
Risks scored LOW are accepted as-is. MED/HIGH each carry an action above. Risk #2 (provider MFA) was **mitigated July 7, 2026** — MFA is now enabled on all core accounts. **One HIGH item remains:** risk #1 (laptop-held service-role keys — see `RUNBOOK-KEYS-MFA.md` Parts 3–5). Next scheduled reassessment: **January 2027** or upon first non-Kennesaw tenant, first employee, or SOC 2 kickoff — whichever comes first.
