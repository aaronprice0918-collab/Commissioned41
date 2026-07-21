# COMMISSIONED 41 — MASTER BLUEPRINT
### The definitive, grounded blueprint for the Commissioned 41 ecosystem
**Audit date:** June 29, 2026 · **Method:** parallel audit of the *actual current code* in all four repos + full project memory (per Aaron's standing rule: *always verify, never trust*). Every claim below was read from source, not recalled. Citations use `path:line`.

---

## 0. METHODOLOGY & STALENESS FLAGS
This was produced by reading the real code in `commissioned41-os` (Dealer), `missionos-lite` (Lite), `missionos-finance` (Finance), `commissioned41-site` (brand site), plus every memory file and `VISION.md`/`C41_MEMORY.md`/`BRAND.md`/`OVERHEAD.md`.

**Stale records corrected during the audit (do not trust these older notes):**
- `BRAND.md` (June 21) still says the AI is "Jimmy" and the dealer tagline is "Live Data. Real Accountability." → **Superseded:** AI = **ILA**; dealer tagline = **"Know the Lead. Execute the Mission."**
- MEMORY index says ILA's voice is "TBD" → **Superseded:** voice is locked to **"Zoey"** (ElevenLabs `ROkSP7oeR0SRS2aHJXMo`).
- `c41-design-language.md`/`c41-ila-persona.md` carry long "navy/neon-green/photoreal-eye" history → **Superseded** by the June‑28 lock: **black + steel‑blue glass, clean command‑core mark, photoreal eye retired.**
- The Dealer `scripts/seed-supabase.mjs` was thought stale → **actually fixed** (multi‑tenant `org_id`, host guard).
- The Lite `missionos-finance` README says "no external services wired" → **wrong:** Plaid + Prisma + AES‑GCM encryption + auth are all built.

---

## 1. EXECUTIVE SUMMARY

Commissioned 41 is a faith‑rooted software company ("Commissioned" = the Great Commission; "41" = the new chapter after the season of testing) building **mission‑first operating systems** under one parent brand. It owns four properties at different maturities:

| Property | What it is | State | Live URL |
|---|---|---|---|
| **Commissioned 41 site** | Parent‑company marketing hub | Live, polished | commissioned41.com |
| **Dealer Mission OS** | AI operating system that *runs a dealership* (not a CRM) | Live, deep, pre‑first‑customer | missionos.commissioned41.com |
| **Mission OS Lite** | Personal financial OS for one commission rep; the on‑ramp | **Live + monetized** ($19.99/mo, hard paywall) | lite.commissioned41.com |
| **MissionOS Finance** | "CFO in your pocket" household financial OS | Built infra, single‑user, not live, no real AI yet | — (port 3007) |

**The single AI brain across all of it is ILA** — Claude Opus 4.8, "Beth Dutton" personality, voice "Zoey," summon‑on‑demand. ILA is the crown jewel and the long‑term north star ("the CEO who owns the app").

**Overall readiness: the ecosystem is a genuine, premium, cohesively‑designed product family that is *closer to launch than most* — but it is gated by a small number of high‑leverage gaps, almost all of which the team already knows about.** The top three:
1. **Billing loops are open.** Neither Dealer nor Lite has a Stripe **webhook** — payments don't reliably map to access/provisioning. Lite's paywall checks Stripe live and **fails *open*** on any error (a Stripe hiccup gives the product away free).
2. **An unauthenticated, un‑rate‑limited AI endpoint is live** in Lite (`/api/parse-payplan`) spending the Anthropic key — the single biggest security/cost exposure.
3. **The data model won't scale as written.** Both Dealer and Lite store each tenant's data as one JSONB blob that is fully rewritten on every change (no concurrency control, no pagination). Fine for the first dealer; strained at "10,000 dealers."

None of these is a rewrite. All are scoped, named fixes. **The product vision is sound and the design bar is genuinely Apple‑grade; the work remaining is hardening the money, the security, and the data shape — then choreographing the last 20% of motion.**

**Overall readiness scores (1–10):** Brand **8** · Design **9** · UX **8** · Architecture **7** · Security **5** · Scalability **4** · Performance **6** · AI **8** · Database **5** · Backend **7** · Frontend **8** · Testing **3** · Documentation **9** · **Overall ≈ 6.5/10** — "impressive and launch‑capable for the first customer; not yet hardened for scale."

---

## 2. COMPANY VISION & NORTH STAR

**Commissioned 41** exists to help people and businesses *take control of the mission in front of them, organize what matters, execute with purpose, and build systems that create freedom, clarity, and measurable growth.*

- **Tagline:** "Know Your Mission. Execute With Purpose."
- **The "drift" thesis:** most people and teams don't fail on purpose — they *drift*. C41 builds the systems that replace drift with intentional, daily execution.
- **Name meaning:** *Commissioned* (the Great Commission — faith‑rooted, never preachy) + *41* (the breakthrough chapter after the trial; 40 = testing, 41 = the new beginning). The cross lives inside the "1" of the C41 mark.
- **Origin:** began as Aaron Price's *personal* operating system (faith, family, finances, discipline, freedom) — "it was never meant to stop with him." Aaron: 20‑year car‑business F&I veteran, Admin/F&I Manager at Kennesaw Mazda, owner of Commissioned 41 LLC (filed June 2026).

**North Star:** *Commissioned 41 becomes the company whose operating systems — each powered by ILA — let any person or business run their mission like a flagship operation. ILA is the through‑line: one intelligence that grows from "the best sales boss in the building" into the operating intelligence of the entire company.*

---

## 3. PRODUCT VISION (per product)

### Dealer Mission OS — *the flagship*
- **Positioning (load‑bearing):** **NOT a CRM** — "the operating system that runs the dealership." Legacy CRMs answer *"Where is my customer?"*; Dealer Mission OS answers *"What should my dealership do next?"* Calling it a CRM invites the VinSolutions/DealerSocket/Tekion comparison; calling it a Dealer OS **creates a new category.**
- **"The ultimate BDC manager in your pocket"** — an AI assistant for every role (Owner, GM, GSM, Sales Mgr, F&I, BDC, Salesperson, Internet Mgr, Service Advisor, Admin). Mobile‑first PWA → App Store.
- **Tagline:** "Know the Lead. Execute the Mission."
- **Two non‑negotiable design laws:**
  - **The Four‑Part Test** — every feature must *save time, increase profit, improve accountability, or elevate the customer experience.* If it does none, it doesn't ship.
  - **The 10‑Second Rule** — a first‑time user must, within 10 seconds, know *what's happening, what needs their attention, what to do next.*
- **Proof screen:** the Manager "Good Morning" brief — the GM walks in and the OS already knows yesterday's units/gross/reserve/response‑time, who almost bought, who's behind on funding, which service customers sit in equity.
- **Go‑to‑market:** win **Kennesaw Mazda's "yes"** (demoed July 2026) → opens the **AMSI dealer group** (Southeast first).

### Mission OS Lite — *the on‑ramp*
- A standalone AI **personal** OS for one commission auto‑sales professional. Answers *"where do I stand, what do I do today, what am I on pace to earn."* The deliberate entry point that pulls a rep toward Dealer Mission OS.
- **Live and monetized:** $19.99/mo, now a **hard paywall** (must sign in + subscribe).
- **Crown jewel:** the universal pay‑plan engine (flat/tiered/grid/hybrid) + Claude pay‑plan parsing from a PDF/photo.

### MissionOS Finance — *the household OS*
- "The CFO in your pocket" — safe‑to‑spend, 30‑day cash‑flow forecast, 0–100 health score, "can I afford this?" decision engine, Plaid‑connected accounts. The flagship *personal financial* OS.
- **Reality check:** infrastructure is real (Plaid, Prisma/Neon, AES‑256‑GCM token encryption, HMAC auth) but it is **single‑user** (one shared password) and has **zero real AI** despite the "AI CFO" branding.

### How they relate (with recommendation)
Lite = the **income side** (paycheck). Finance = the **household side** (whole financial life). They are **complementary, not duplicates.** **Recommendation:** keep them as two products; make Lite the live, narrow, monetized on‑ramp and Finance the broader OS; **extract Lite's pay‑plan engine into a shared package** and let Finance consume Lite's commission forecast as its income feed rather than re‑implementing it. Do **not** collapse one into the other while Lite is the only one earning.

---

## 4. ECOSYSTEM & BRAND HIERARCHY

```
COMMISSIONED 41  ── the company / the mission (C41 chrome logo = the face)
   ├─ Dealer Mission OS   ── chrome "M" mark · missionos.commissioned41.com
   ├─ Mission OS Lite     ── chrome "M" + "LITE" · lite.commissioned41.com
   ├─ MissionOS Core      ── owner‑only personal exec OS (inside the dealer app, /mission-core)
   ├─ MissionOS Finance   ── household financial OS (separate repo)
   └─ (future) MissionOS Home / Business
```
**Brand rule:** the broad life mission belongs to *Commissioned 41*, never to a single product. Every product lives on its **own subdomain** of commissioned41.com — no raw `*.vercel.app` links.

---

## 5. MASTER CONSOLIDATION (one unified view)

**Duplicate / overlapping ideas**
- Two count‑up implementations in Dealer (a shared `CountUp` component **and** a hand‑rolled `useCountUp` in `app/page.tsx`). → Standardize on one.
- "Safe‑to‑spend / projected paycheck / daily brief / health framing" exist in *both* Lite and Finance. → Intentional (different halves of money) but the **pay‑plan engine** must not diverge — extract it to a shared package.
- Lite `/subscribe` card UI and the in‑app `Paywall` now correctly share `SubscribeCard` (already de‑duplicated).

**Conflicting / inconsistent decisions**
- **Token names lie:** in both the site and Dealer, `--mission-green` and `--mission-gold` hold *steel‑blue* values. A real cross‑repo trap — rename to `--mission-accent` / `--mission-accent-light`.
- The site uses `--accent` (Lite) vs `--mission-*` (Dealer/site) for *the same steel‑blue color* across repos → three different variable names for one color. Unify a shared token vocabulary.
- Product **marks**: the site ships a flat `mission-mark.png`, while the beautifully‑built `LiteCore`/`IlaCore` "living cores" are **orphaned** (zero imports). Decide: living cores or flat M — and apply consistently.

**Missing pieces (cross‑cutting)**
- **Stripe webhooks** (Dealer + Lite) → no reliable payment→entitlement/provisioning.
- **Customer portal / cancel** for Lite subscribers (none → support load + chargebacks).
- **Real AI in Finance** (branded "AI," contains none).
- **Multi‑user auth in Finance** (single shared password).
- **Test coverage** everywhere (only pay‑math is tested).
- **SEO essentials** on the site (sitemap, robots, favicon, OG image, JSON‑LD).
- **Form storage** on the site (contact/join data is effectively lost in prod without Supabase env set — file writes no‑op on Vercel).

**Redundant / dead weight**
- ~3MB of unreferenced brand assets in the site's `public/brand/` (heavy color SVGs, JPGs, silhouettes) — repo bloat, not shipped.
- Orphaned components: site `LiteCore`, `IlaLivingCore`, `JoinForm` (+ unreachable `/api/join` UI).

**Naming inconsistencies**
- "waitlist" route in Dealer is actually the owner "C41 HQ" pipeline command center (mislabeled).
- "MissionOS Core" naming is an open question (does the owner OS want its own brand name?).

**Structural risks (carried to §17–19):** JSONB‑blob‑per‑tenant data shape; fail‑open security philosophy; service‑role‑bypasses‑RLS; no concurrency control.

---

## 6. PRODUCT READINESS SCORECARD

Format: **Now → Target · Reason · Action · Priority (P0 critical … P3 nice) · Effort (S/M/L)**

| Category | Now | Target | Reason | Action | Pri | Effort |
|---|---|---|---|---|---|---|
| **Brand** | 8 | 10 | Cohesive steel‑glass identity, disciplined "drift" copy; orphaned core marks + flat product mark | Decide living‑core vs M mark, apply ecosystem‑wide; rename misleading tokens | P2 | S |
| **Architecture** | 7 | 9 | Clean choke‑point + provider model; capped by blob‑per‑tenant shape | Move high‑volume entities (deals/leads) to relational rows; shared packages | P1 | L |
| **Design** | 9 | 10 | Mature living‑glass system, premium chrome/shimmer | Hold the line; fix contrast on dim text | P2 | S |
| **UX** | 8 | 10 | Strong funnels, drill‑downs, 10‑second discipline | Finish "if it looks interactive it must be"; Lite cancel/manage | P1 | M |
| **UI** | 8 | 10 | Consistent components; minor pattern drift | One count‑up, one ring, one card system across apps | P2 | M |
| **Security** | 5 | 9 | Thoughtful crypto, but systemic *fail‑open*; one unauth AI route | Fix the §17 Top‑5 this week | **P0** | M |
| **Scalability** | 4 | 8 | Whole‑blob rewrite, no concurrency/pagination | Relational entities + optimistic concurrency + webhook entitlements | P1 | L |
| **Performance** | 6 | 9 | Full‑blob loads, large client pages; prompt caching good | Split 1393‑line files, paginate, cache entitlements | P2 | M |
| **AI** | 8 | 10 | Opus‑4.8 brain w/ tools + persistent memory (Dealer); Finance has none | Add real AI to Finance; reuse Lite's Claude pattern | P1 | M |
| **Infrastructure** | 7 | 9 | Subdomains, staging harness, CI; some env not wired | Wire Upstash, Resend/CRON, rotate flagged keys | P1 | M |
| **Automation** | 5 | 8 | Nightly brief cron built; rate‑limit/email off without env | Turn on Upstash + Resend; webhook automation | P2 | M |
| **Database** | 5 | 9 | KV‑JSONB w/ RLS backstop (Dealer/Lite); Finance is proper relational | Normalize hot entities; verify Lite RLS; keep Finance schema | P1 | L |
| **Backend** | 7 | 9 | Solid route guards; missing webhooks; one un‑`force-dynamic` AI route | Webhooks; `force-dynamic` on `ai/crm`; fail‑closed gates | P0/P1 | M |
| **Frontend** | 8 | 10 | Cohesive system, mobile‑first; minor drift + orphans | Remove orphans; unify components | P2 | S |
| **Accessibility** | 6 | 9 | Good ARIA/reduced‑motion; dim‑text contrast fails AA; no focus trap | Raise contrast tiers; focus‑trap mobile sheets | P2 | S |
| **Documentation** | 9 | 10 | Exceptional living docs | Keep current; prune stale notes flagged in §0 | P3 | S |
| **Maintainability** | 7 | 9 | Single‑source config exemplary; misleading tokens + dead code | Token rename; delete orphans/3MB assets | P2 | S |
| **Code Quality** | 7 | 9 | Typed, commented, consistent; a few 700–1400‑line files | Split crm‑desk, page.tsx | P2 | M |
| **Testing** | 3 | 8 | Only pay‑math tested; CI build‑only | Test API guards, pay/desk engines, the gate; add E2E | P1 | L |
| **Deployment** | 8 | 9 | Git‑connected auto‑deploy; staging harness | Branch‑preview env parity for paywalled flows | P3 | S |
| **Monitoring** | 4 | 8 | Capped telemetry ring only | Real error/uptime monitoring, billing alerts | P2 | M |
| **OVERALL** | **6.5** | **9** | Launch‑capable for first customer; not hardened for scale | Execute §24 roadmap | — | — |

---

## 7. PRODUCT ARCHITECTURE

**Dealer Mission OS** — Next 14 PWA on Vercel + Supabase. State = one **`app_store(org_id, key, value jsonb)`** row per (org, key); 14‑key allow‑list. Single server choke‑point `app/api/store/[key]/route.ts`: validates the Supabase JWT, resolves org **from the user's profile (never client input)**, applies **per‑key role read‑filtering** (`filterForUser` redacts other reps' PII, hides owner keys) and **authorship merge** on write (`mergeDeals`/`mergeCrmLeads`/…). Client providers (Deal/Crm/PayPlan/Goal/Team/StoreSettings/Auth/Theme/ProfilePhoto/Chat) load‑once → debounced whole‑blob save. Multi‑tenancy in `lib/orgs.ts` + `lib/provision.ts` (`provisionOrg`). `middleware.ts` splits apex / app subdomain / `hq.` owner portal.

**Mission OS Lite** — client‑first: localStorage `missionos-lite-v1` is source of truth, **optional** Supabase `lite_state` sync (cloud‑wins‑on‑sign‑in, debounced 600ms). Degrades to fully on‑device when Supabase env absent. The new paywall gate lives in `app/page.tsx` (`use client`): `ready → AuthScreen → entitlement check → Paywall → Onboarding → app`.

**MissionOS Finance** — server‑first Next 16/React 19. Pure‑function engine (`src/lib/engine.ts`) over a real Prisma/Neon schema (PlaidItem/Account/Transaction/UserConfig) with `loadProfile` as the DB‑or‑mock seam. Single‑tenant (`UserConfig` id `"singleton"`).

**Brand site** — Next 14, App Router, single‑source `config/site.ts`, fail‑soft contact/join APIs.

---

## 8. DATABASE ARCHITECTURE

| Product | Store | Shape | Isolation | Concurrency | Verdict |
|---|---|---|---|---|---|
| Dealer | Supabase `app_store` | **JSONB blob per (org,key)**, 14 keys | RLS exists but app runs as **service‑role (RLS bypassed)** → API code is the sole wall | **None** — blind last‑write‑wins upsert | Pragmatic, un‑normalized; **#1 scale risk** |
| Lite | Supabase `lite_state` | one JSON blob per user | depends on **unverified** RLS | localStorage is truth; sync debounced | Works; verify RLS owner‑only |
| Finance | Neon Postgres / **Prisma** | proper relational (indexes, cascade, encrypted tokens, sync cursor) | single‑tenant by design | normal DB | **Best DB design of the four** |

**Action:** (1) Verify Lite RLS (`user_id = auth.uid()`). (2) Add a real RLS backstop to Dealer (today production = 100% service‑role; one missed `org_id` filter leaks across dealerships with no DB safety net). (3) Move Dealer's hot entities (`deals`, `crmLeads`) from one blob to per‑row tables with optimistic concurrency (`version`/`If-Match`) — this kills both the lost‑update risk and the full‑blob‑rewrite cost.

---

## 9. API ARCHITECTURE

- **Dealer:** `/api/store/[key]` (the spine), `/api/ai/*` (crm, core, hq, setup, import, license‑scan, insurance‑scan, voice, daily‑report + `/cron/daily-report` CRON‑gated), `/api/users`, `/api/checkout`, `/api/telemetry`. **No Stripe webhook.** Most routes set `dynamic="force-dynamic"` — **`ai/crm` does not** (build‑time fragility; add it).
- **Lite:** `/api/checkout` (subscription session, email passed), `/api/entitlement` (verifies Supabase token → live Stripe lookup by email), `/api/parse-payplan` (**unauthenticated** Claude call — fix). **No webhook.**
- **Finance:** auth (login w/ timing‑safe compare + in‑memory rate limit), Plaid (link‑token / exchange / sync). CSRF origin check. Parameterized Prisma throughout.
- **Site:** `/api/contact`, `/api/join` — 3‑layer fail‑soft (Supabase → Resend → JSONL), env‑gated; **no rate limit** (email‑bomb risk on `/api/join`).

**Cross‑cutting actions:** add signature‑verified **Stripe webhooks** → local `entitlements`/`org_status` tables; **rate‑limit** the public/AI/email routes; make money/AI gates **fail‑closed**.

---

## 10. AI ARCHITECTURE (ILA)

- **Brain:** `app/api/ai/crm/route.ts` (~974 lines) — **Claude Opus 4.8**, large persona+playbook system prompt with **prompt‑caching breakpoints** (stable brain vs. volatile store snapshot), **7 tools** (`query_deals`, `rep_detail`, `lookup_rate`, and persistent `remember_rep/customer/pattern/mistake` written back to `app_store` — real coaching memory), retry‑with‑backoff on 429/5xx/529. Gated per store by `storeSettings.aiAssistantEnabled` (owner always on).
- **Persona:** ILA (renamed from Jimmy) — **"Beth Dutton"** energy (commanding, sharp, protective of her people, savage toward lost gross) **minus the profanity**. Voice **"Zoey"** (ElevenLabs). Summon‑on‑demand orb (`CommandDeck.tsx`), not a permanent bar. Mark = the clean **command core** (`IlaCore.tsx`); photoreal eye retired.
- **Surfaces:** MorningBrief, NightlyBrief, CrmAiPanel, the Command Deck; owner‑only `core`/`hq`.
- **Lite AI:** one genuine Claude call — pay‑plan parsing (`/api/parse-payplan`) with robust role‑default fallback. "Coach" is rules, honestly.
- **Finance AI:** **none** — branded "AI CFO," entirely deterministic heuristics. Biggest gap vs. the pitch.
- **Doctrine:** *never trade away ILA's intelligence to save money* — cut cost via caching/efficient context/model tiering, never by dumbing her down.
- **North star for ILA:** tenant‑facing floor boss → owner‑facing app operator → the operating intelligence of the whole company.

---

## 11. COMPLETE FEATURE INVENTORY

### Dealer Mission OS (37 routes)
**Complete & data‑wired:** Mission Control home (pace ring, count‑ups, ILA coaching push), `crm-desk` (Showroom floor + desking + VIN/license/insurance scan — 1393 lines, the spine), `my-scorecard` (private pay scorecard, `calculateSalesPay`/`calculateFinancePay`), `admin` (roster/logins/pay‑plans CRUD), `desking`, `finance-desk` (real `finalize()` → deal → lead Won), `finance-command`, `gm-command` (segment money, holdback, trade equity), `deal-center`, `deal-entry` (full edit console w/ live preview), `rdr-center`, `goals`, `team-command`, `deal-scorecard`, `appointments`, `follow-up` (0–100 lead scoring + cadence), `recognition-feed`, `store-settings`, `setup` (AI rate‑sheet parse), `import` (AI deal‑log import), `private-chat`, `mission-core` (owner exec OS), `waitlist` (= owner "C41 HQ" pipeline), `business-card` + public `card/[slug]`, `pricing`/`welcome`/`signup`.
**Partial (honest):** `equity` (trade‑up radar, no dollar figure pending inventory/valuation feed).
**Thin (by design):** `lease` (mounts LeaseDesk), `employee-profile` (redirect), `commands` (alias), `ila-audition` (temp voice picker).
**Net‑new (the CRM front half):** unified AI‑prioritized Lead Inbox, 5‑Minute Speed‑to‑Lead, AI Follow‑Up Center (Day 1/3/7/14/30), Appointment Board, Manager TO + lost‑reason, Equity Mining, Service‑Drive Opportunities, Customer‑360 Journey timeline (several recently built per `C41_MEMORY.md`).

### Mission OS Lite
Onboarding (pay‑plan upload OR guided builder, seeds a demo month), Dashboard (animated projected paycheck worst/likely/best + confidence, pace, commission‑rate card, next‑tier cards, goal ring + goal‑hit celebration, today's mission, step‑by‑step "how it adds up"), <60s deal entry, personal Pipeline, Daily Mission Brief, Settings, PlanEditor, biometric Face/Touch‑ID lock, installable PWA, Supabase accounts + cloud sync. Engines: `lib/payplan/calc.ts` (flat/tiered/grid/hybrid, next‑tier ranking, confidence), `lib/engine.ts` (forecast), `lib/coach.ts` (rules). **The new paywall:** AuthScreen, entitlement check, Paywall/SubscribeCard, checkout. Free vs premium = **no free tier; hard paywall** ($19.99/mo).

### MissionOS Finance
Built (engine‑level): safe‑to‑spend, 30‑day cash‑flow forecast, 7‑factor health score (0–100), decision engine ("can I afford this?"), debt/investments/bills/subscriptions/income roll‑ups, rule‑based daily brief, Plaid connect + cursor sync, encrypted token storage, single‑user HMAC auth. **Not built:** real AI, multi‑user/tenancy, tests.

### Brand site
Home, Mission, Products, About, Contact — all complete, strong copy. Two product gateways (M marks), freed C41 logo (3D‑tilt hero), living‑glass design system, motion layer (ScrollProgress, button sheen, chrome‑shimmer, blur‑in reveals), fail‑soft contact/join.

---

## 12. DESIGN SYSTEM & UI STANDARDS

**Locked "living glass" system:** near‑black base with midnight‑blue depth ("liquid glass black," no starfield); **steel‑blue** primary accent; platinum chrome; **crimson for alerts only**; lime green retired.
**Signature elements:** `.glass` (blur + saturate + inset highlight), `.living-border` (a steel‑blue→white comet laps the rim, ~4.5s, reduced‑motion → static) on signature surfaces only, `.chrome-text`/`.chrome-shimmer`/`.steel-text`, the `.eyebrow` leader line, ambient drifting orbs.
**The official logo = the wordmark:** chrome "MISSION" + steel "OS" (`BrandMarks.tsx`), Dealer adds a "DEALER" eyebrow. **Brand marks:** C41 logo = company face (freed transparent PNG + vector); chrome **M** = Dealer; **M + "LITE"** = Lite; **clean command core** = ILA.
**Color = meaning (fixed):** electric/steel blue = information, emerald = success, amber = attention, crimson = urgent, platinum = premium.
**Known inconsistencies to fix:** misleading `mission-green`/`mission-gold` token *names* (hold blue values); three repos, three variable names for one accent; orphaned `LiteCore`/`IlaCore` vs flat `mission-mark.png`; dim‑text contrast below AA.

## 13. UX STANDARDS
**Apple simplicity + Tesla responsiveness + enterprise capability.** Teammate, not software — reduce stress, build confidence. **Fifth‑grade rule** (no jargon, no deep menus, no tiny buttons, common actions 1–2 clicks). **Zero‑clutter** (every element justifies itself). **10‑second rule** on every primary screen. **"If it looks interactive, it must BE interactive"** (stat cards drill into their list). Dashboards are **live command centers, not reports.** Goal: *"this is how it should have always worked."*

## 14. ANIMATION / MOTION STANDARDS
**"Feels like the future" — everything alive, nothing static, motion always reinforces understanding (never decoration).** Numbers count up, rings fill, progress moves, delight moments (goal‑hit, deal‑sold, bonus tier). **Rollout:** ✅ Site motion layer · ✅ Lite (CountUp/ProgressRing/goal‑hit) · 🟡 Dealer (pace rings on home/goals/GM, scorecard count‑ups merged; **still open:** deal‑pipeline drag choreography, activity timeline, live notification stream — the higher‑risk 1393‑line CRM board). Deliberately **not** animating list/table boards (would be noise).

---

## 15. NAVIGATION MAP
- **Site:** Home · Mission · Products · About · Contact (+ two product gateways → subdomains). Apex redirects `/login /signup /terms /privacy /card/*` → app subdomain.
- **Dealer:** AppShell sidebar grouped by function → Mission Control · CRM Desk · Desking · Finance (desk/command) · GM/Team command · Scorecards · Goals · Appointments · Follow‑up · Deal Center/Entry/RDR · Recognition · Store Settings · Admin · (owner) Mission Core / HQ. ILA Command Deck floats on every screen.
- **Lite:** Gate (Auth → Paywall) → Onboarding → AppShell (Home/Dashboard · Pipeline · Daily Brief · Settings · Subscribe).
- **Finance:** Login → Dashboard (rings, forecast, decisions, connect bank).

## 16. USER FLOWS (key)
1. **Lite buyer (live):** open app → sign in/create account → entitlement check → **Paywall** → Stripe checkout ($19.99/mo) → return → entitlement active → Onboarding → Dashboard. *Gap: webhook, cancel/manage portal, fail‑closed entitlement.*
2. **Dealer onboarding (today):** owner‑provisioned (`provisionOrg`) — **payment does not auto‑create an org** (no webhook; signups gated closed).
3. **Manager "Good Morning":** open Dealer → Mission Control → ILA brief → drill any KPI → act in 1–2 taps.
4. **Rep:** my‑scorecard → animated projected pay → next‑tier moves → log deal <60s.

---

## 17. SECURITY AUDIT (enterprise / OWASP)
**Overall security readiness: 5/10.** Thoughtfully built (correct AES‑256‑GCM Plaid encryption, constant‑time password compare, server‑side JWT verification, parameterized DB access, no XSS/SQLi/CORS holes, no card data touched, no secrets in logs) — but a **systemic fail‑open philosophy** sits exactly where money and AI cost are gated.

**TOP 5 — fix before scale (the first two this week):**
1. **CRITICAL — Lite `/api/parse-payplan` is unauthenticated + un‑rate‑limited** (`:43,67`): anyone on the internet can POST 120K‑char/PDF payloads and spend your Anthropic key. → Require valid Supabase JWT + active entitlement; rate‑limit; cap payload.
2. **CRITICAL — Lite entitlement fails *open*** (`entitlement/route.ts:16` and `:42‑45`): missing Stripe key *or any Stripe error* → `active:true` for everyone. One typo or outage = free product. → Fail **closed** in prod.
3. **HIGH — Dealer rate limiter fails open** (`lib/rateLimit.ts:29,43,47`): the only AI cost control, off whenever Upstash env is unset, across 8 cost‑bearing routes. → Fail closed for cost routes; alert if Upstash unset.
4. **HIGH — Dealer runs 100% service‑role (RLS bypassed)** (`lib/supabaseServer.ts`): app code is the sole tenant wall; stale `schema.sql` has no org_id. → Make RLS a real backstop; centralize an org‑injecting query helper; delete stale schema.
5. **HIGH — Finance session secret fails open** (`session.ts:13‑15,45`): empty `APP_SESSION_SECRET` mints forgeable tokens. → Throw if missing/<32 bytes (before Finance goes live).

**Also:** no Stripe **webhook/signature** anywhere (entitlement live‑query amplifies fail‑open, no audit trail); Lite paywall is **client‑side only** (enforce on protected/AI routes server‑side); site `/api/join` has no rate limit (email‑bomb); `canWrite` defaults to `true` (default‑deny instead); checkout email from request body not session; verify Lite RLS; rotate the flagged staging service‑role key + brand‑site Vercel token; the historically‑committed **anon** key is public‑by‑design (Low) but rotate opportunistically.

**Per‑area scores:** Secrets **8** · AuthN/Z **5** · Tenant isolation **5** · Financial/PII **8** · Stripe/webhooks **4** · Validation/CORS/CSRF/XSS/SQLi **7** · Rate‑limit/abuse **3** · Logging/deps **7** · Env fail‑open‑vs‑closed **4**.

---

## 18. PERFORMANCE AUDIT
- **Dealer:** prompt‑caching + retry on AI is strong; but **full‑blob loads** (ILA snapshots 9 keys at once), no pagination/indexes beyond PK, and 700–1400‑line client pages add weight. Add `force-dynamic` to `ai/crm`.
- **Lite:** localStorage is instant; ceiling is **per‑request Stripe** on every app open (`customers.list` then `subscriptions.list` per customer — N+1). Cache entitlement via webhook table.
- **Finance:** clean server‑first; fine at single‑user scale.
- **Site:** `next/image` everywhere, ~680KB shipped image weight, GPU‑cheap motion; ~3MB unused assets are repo bloat only.

## 19. TECHNICAL DEBT REPORT
1. **JSONB‑blob‑per‑tenant** (Dealer + Lite) — full rewrite per change, blind last‑write‑wins, no concurrency/pagination. *(highest‑leverage debt)*
2. **No webhooks** → open billing loops both products.
3. **Fail‑open security** in money/AI/auth paths.
4. **Service‑role bypasses RLS** (Dealer) — single wall.
5. **Large files** (`crm-desk` 1393, `page.tsx` 554, `lib/data.ts`/`salesPlaybook.ts` ~40KB).
6. **Two count‑up implementations**, orphaned components/assets, misleading token names.
7. **Near‑zero test coverage**; CI is build‑only.
8. **Finance:** stale README, single‑password auth, no AI, no tests.
9. **Site:** form storage not wired (data lost in prod), missing SEO essentials.
10. **Dealer hydration warning** at `AppShell.tsx:240`.

## 20. MISSING FEATURES
Stripe webhooks (both) · Lite customer portal/cancel + grandfathering · Real AI in Finance · Multi‑user Finance auth · Dealer Communication Hub (Twilio/A2P) + AI Call/Text Review · live inventory feed (ILA inventory brain) · Resend nightly‑brief email + CRON · Upstash rate limiting · Equity dollar figures · site sitemap/robots/favicon/OG image/JSON‑LD · tests/monitoring across the board.

## 21. RECOMMENDED IMPROVEMENTS
Extract a shared **pay‑plan engine** package (Lite→Finance) · shared **design‑token** package (one accent vocabulary) · normalize Dealer hot entities + optimistic concurrency · webhook‑driven entitlements table (Lite) and org‑provisioning (Dealer) · fail‑closed money/AI gates · split the big files · unify one CountUp + one Ring + one Card across apps · remove orphans/dead assets · raise dim‑text contrast + focus‑trap mobile sheets · turn on Upstash/Resend/CRON · add E2E + API‑guard + engine tests.

## 22. EXPERIENCE AUDIT
**Strengths:** genuinely premium, opinionated, role‑aware; fast onboarding; animated paycheck/goal‑celebration build confidence; ILA's persona is a differentiator; mobile‑first discipline. **Frictions:** Lite has no in‑app cancel/manage (trust + chargeback risk); site "General inquiries" card is a dead decoration and "Join the Mission" capture is unreachable; dim‑text contrast hurts readability "across the room"; no focus‑trapping; the gate's fail‑open paths could confuse (free access during outage). **Verdict:** the *feel* already meets the bar; the *trust mechanics* (billing transparency, contrast, reachable channels) need finishing.

## 23. BUSINESS AUDIT / UNIT ECONOMICS
- **Costs:** fixed ≈ **$168/mo** (Claude Max $100 [a build cost], Supabase Pro $25, ElevenLabs $22, Vercel Pro $20, domain ~$1.25); steady‑state run ≈ **$68/mo** + Anthropic usage. Per‑store COGS ≈ $70–160.
- **Pricing:** Dealer modeled at **$499/store/mo** (store #1 covers all fixed overhead; ~73–80% margin after); Lite **$19.99/mo** live.
- **Can it be the best?** **Yes — credibly.** Lite already monetizes a real, hard problem (commission visibility) with a genuinely strong engine. Dealer's "OS not CRM" thesis + ILA's persistent‑memory brain is a real category wedge if the CRM front‑half and billing loop land. Finance is a strong third pillar once it gets real AI + multi‑user. The moat is **ILA + the design bar + the mission‑first discipline.**

---

## 24. PRIORITIZED ROADMAP

**P0 — This week (money + cost security; all small/medium):**
1. Auth‑gate + rate‑limit Lite `/api/parse-payplan`.
2. Make Lite entitlement **fail‑closed**; drop raw error from response.
3. Make Dealer rate limiter fail‑closed for AI routes; add `force-dynamic` to `ai/crm`.
4. Stripe **webhook** for Lite → `entitlements` table (kill per‑request Stripe + fail‑open); add **customer portal/cancel**.
5. Rotate flagged keys (staging service‑role, site Vercel token).

**P1 — This month (close the loops, harden data):**
6. Stripe **webhook → auto‑provision org** for Dealer; open self‑serve signup when ready.
7. RLS backstop + org‑injecting query helper (Dealer); verify Lite RLS.
8. Begin normalizing Dealer hot entities (`deals`,`crmLeads`) → per‑row + optimistic concurrency.
9. Wire Upstash (rate limit), Resend + CRON (nightly brief email).
10. Test coverage: API guards, pay/desk engines, the Lite gate; first E2E.
11. Site: wire form storage (Supabase/Resend), add SEO essentials.

**P2 — This quarter (polish + consistency):**
12. Finish Dealer Phase‑3 motion (pipeline drag, activity timeline, live notifications).
13. Unify components/tokens across apps; remove orphans/3MB assets; fix contrast/focus traps.
14. Finance: real AI layer (reuse Lite's Claude pattern) + multi‑user auth + tests + README fix.
15. Real monitoring + billing alerts.

---

## 25. VERSION SCOPES

**v1.0 (first paying customer):** Lite hard paywall **secured** (P0 done) + Dealer demo that wins Kennesaw's "yes" (the CRM front‑half + Manager Good‑Morning brief on real data) + billing loops closed (webhooks) + the security Top‑5 fixed. *Goal: one dealer live, Lite revenue safe.*

**v2.0 (multi‑dealer + household):** Dealer self‑serve signup + auto‑provision + relational data + RLS + tests; Finance live (real AI + multi‑user); shared pay‑plan + token packages; Communication Hub (Twilio/A2P) + inventory feed; ILA owner‑facing app‑operator mode.

**Long‑term:** the AMSI dealer group → SaaS at scale; MissionOS Home/Business; ILA as the operating intelligence of the whole company; app‑store distribution; enterprise compliance (SOC2‑track), real monitoring/observability, and a normalized, sharded data platform.

---

## 26. PRODUCTION READINESS CHECKLIST
☐ Lite `parse-payplan` authed + rate‑limited ☐ Lite entitlement fail‑closed ☐ Stripe webhooks (Lite + Dealer) ☐ Lite cancel/portal ☐ Dealer rate‑limiter fail‑closed + `ai/crm` `force-dynamic` ☐ RLS backstop + Lite RLS verified ☐ Keys rotated ☐ Upstash + Resend + CRON wired ☐ Finance session‑secret fail‑closed (pre‑live) ☐ Site form storage + SEO essentials ☐ Contrast/focus‑trap a11y ☐ API‑guard + engine + gate tests ☐ Error/uptime monitoring + billing alerts ☐ Orphans/dead assets removed ☐ Token vocabulary unified ☐ Big files split.

## 27. LAUNCH CHECKLIST (per property)
- **Lite (live now):** finish P0 (#1–4) → it's launch‑safe. Then: cancel/manage, grandfathering decision, monitoring.
- **Dealer:** Kennesaw demo polished on real data → "yes" → webhook auto‑provision → open signups → onboard AMSI.
- **Finance:** real AI + multi‑user auth + fail‑closed session secret + Plaid prod creds + tests → soft launch.
- **Site:** form storage + SEO/OG + contrast → it's the front door for all three.

---

## 28. NORTH STAR
**Commissioned 41 is the company that turns drift into execution — one premium, ILA‑powered operating system at a time.** Dealer Mission OS makes a dealership run itself; Mission OS Lite puts a rep in control of their paycheck; MissionOS Finance is the CFO in every pocket. They share one design language, one intelligence (ILA), one discipline (the mission‑first, Four‑Part‑Test, 10‑second standard). The endgame: **ILA grows from the best sales boss in the building into the operating intelligence of the entire company — and Commissioned 41 becomes the operating‑system company for people and businesses who refuse to drift.**

*Build it right. Verify everything. Premium or nothing.*
