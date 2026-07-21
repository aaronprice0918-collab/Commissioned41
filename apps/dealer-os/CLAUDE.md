# Dealer Mission OS (repo: commissioned41-os)

> **Naming (June 26, 2026):** the dealer product was renamed **MissionOS → "Dealer Mission OS"**. "Mission OS" is now the platform *family* (Commissioned 41 will ship more than one OS); this repo is the **dealer** one. The owner-only personal exec OS at `/mission-core` (+ `api/ai/core`) is a *separate* product and is still **"MissionOS Core"** — do NOT rename it. Older "MissionOS" mentions below = the dealer product unless they say "Core".

**Read `C41_MEMORY.md` in this folder before doing anything** — it's the running
project log: decisions, architecture, what's done, what's next. Always check it
first, and keep it updated as work progresses.

## The vision — Aaron's north star (read this FIRST, judge every feature by it)
**See `VISION.md` for the full positioning + 21-module map.** The headline:
Dealer Mission OS is **NOT a CRM** — it's the **operating system that runs the
dealership**. Legacy CRMs answer *"Where is my customer?"*; Dealer Mission OS
answers *"What should my dealership do next?"* Calling it a CRM invites the
VinSolutions/DealerSocket/Tekion comparison; calling it a Dealer OS creates a new
category. One platform, every department, one customer record, one AI brain.

> **THE FOUR-PART TEST — apply to every screen/feature.** It must **save time/
> simplify work**, **increase profit**, **improve accountability**, or **elevate
> the customer experience**. If it does none of those four, it does not belong.
>
> **THE 10-SECOND RULE — apply to every primary screen.** A first-time user must,
> within 10 seconds: understand what the page does, spot the most important info,
> and know what action to take. Fails the test → redesign it. Every screen answers
> three questions immediately: *What's happening? What needs my attention? What
> should I do next?* One/two-click max for common tasks (call, text, email,
> schedule, start deal, log note, manager TO, desk, turn to finance). AI surfaces
> what's needed before the user asks. Apple-simple: breathing room, no clutter, no
> tiny buttons, no hidden menus, no spreadsheet-of-rows. **Full UX Laws in `VISION.md`.**

It is **the ultimate BDC manager in your pocket** — an AI **assistant** for every
role (sales rep, F&I, sales manager, BDC, GM, service). It doesn't store data, it
tells you the next best move and helps you make it. Bar, in Aaron's words: *"If
you run a dealership in the U.S. and you don't have it on your phone, you're
missing the ball."* Tagline: **Know the Lead. Execute the Mission.**
- **Mobile-first, on your phone.** PWA today → App Store. Every feature must feel
  great one-handed on a phone on the floor.
- **An assistant, not a database.** Proactive: who to follow up with, draft the
  text/call, nudge no-shows to reschedule, surface hot ups, the next best action.
  (Seed already exists: `CrmAiPanel`.)
- **Alive — feels like a teammate.** Real-time heartbeat (CRM Desk has a 12s data
  pulse + LIVE indicator). "Animate where you can; make it a live part of the team."
- **Every feature test:** does this make MissionOS the must-have assistant in a
  dealer's pocket? If it's just logging, it's not enough.

> **🧠 ILA DOES EVERYTHING — a hard rule, not an aspiration.** Every capability the
> app has, ILA (`app/api/ai/crm/route.ts`) must be able to do too. **A feature is
> NOT done when the screen works — it's done when ILA can do it as well.** So for
> every new feature, ship an ILA tool for it that reuses the SAME lib the screen
> uses (one brain, no divergence), privacy-scoped like the screen. Before calling
> any feature complete, ask: "can ILA do this?" If not, it's not finished. (ILA's
> tools should track 1:1 with the screens: query_deals, rep_detail, estimate_pay,
> next_leads, appointments, equity, deals_at_risk, lookup_rate, remember_*.)

## The 10-second orientation
- **Company:** Commissioned 41 (LLC, domain commissioned41.com).
- **Product:** "MissionOS" — the dealership commission/CRM operating system. The
  chrome **M** is the mark; product name is MissionOS (company = Commissioned 41).
- **Direction:** going **SaaS** (sell to many dealerships). Kennesaw Mazda is the
  first tenant / proof-of-concept.
- **Live URLs:** app at https://missionos.commissioned41.com (the product home,
  free subdomain). https://commissioned41.com still serves the app too for now;
  eventual plan is root = company marketing, subdomain = the app.
- **Owner login:** aaronprice0918@gmail.com (Admin). No in-app password change yet
  — reset via Supabase auth admin API with the service-role key if needed.
- **Stack:** Next.js PWA on Vercel + Supabase (`app_store` JSONB key-value table,
  `user_profiles`). Deploys to production on push to `main`.
- **Owner:** Aaron Price (aaronprice0918@gmail.com), LLC filed June 2026.

## Active work
- **Multi-tenancy is LIVE in prod** (migrated June 22, 2026; merged to `main`).
  Every store is its own org; Kennesaw = org `00000000-…-0001`. Self-serve signup
  is built but CLOSED behind `NEXT_PUBLIC_SIGNUPS_OPEN` (demo-only until Stripe).
  Jimmy is per-tenant + open to every rep. See C41_MEMORY.md top sections for the
  current state and the still-open list (Stripe billing; group reporting).

## Working rules
- **UX standard (Aaron): if it looks interactive, it must BE interactive.** Summary
  / stat cards drill into the underlying list; tappable-looking things do something.
  Keep MissionOS genuinely user-friendly. Pattern: `MetricCard onClick` → modal list
  (see `app/crm-desk/page.tsx`). Roll this across every dashboard.
- A change isn't done until it's committed AND pushed to `main` (Aaron judges work
  on the live site, not localhost).
- **Always back up to GitHub after hours of work (Aaron, standing rule).** Once a
  session has put in real work, `git push` the current working branch to `origin`
  (even an unmerged feature branch like `glass-redesign`) so nothing lives only on
  the laptop. Pushing a branch is a backup, NOT a deploy — only merging to `main`
  goes live, and that still waits for Aaron's review.
- Never improvise schema changes on the prod Supabase DB — real comp data is live.
  Tenant isolation must be proven on a non-prod DB first.
- Brand mark lives in `components/BrandMarks.tsx` + `public/brand/mission-*.png`.
