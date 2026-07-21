# EILA (MissionOS Lite)

**EILA** is the AI companion for commission earners — sales, F&I, and beyond.
Know exactly where you stand, what to do next, and what you're on pace to
earn — then let EILA do it with you. Public name: **EILA** (always spelled EILA);
"MissionOS Lite" is the internal project name only.

Live at **lite.commissioned41.com** · $19.99/mo via Stripe (team codes comp
whole stores).

## What's here
- **Mission page** — bold status up top (EILA's greeting, The Climb to your
  take-home goal, projected paycheck, today's mission); every granular number
  one tap down in the "See all your numbers" drawer.
- **EILA chat with hands** — she doesn't just talk: she logs deals, corrects
  them, sets goals, fixes plan config, manages bills/budgets/goals/spend,
  runs can-I-afford-it verdicts, and learns durable notes about you
  (`lib/ila-tools.ts` → executed client-side in `lib/ila-hands.ts`).
- **Pay engine** (`lib/payplan/`) — universal plan model (flat / tiered /
  grid / per-deal / hybrid), draw & guarantee ledger, tested to the cent
  against independent oracles (`tenDealAudit.test.ts`).
- **Stats** — chart board + printable month-end payroll report (`/report`).
- **Money** — the CFO side: balance, bills, budgets, goals, safe-to-spend,
  daily spending allowance, statement scanning.
- **Pipeline & follow-up queue** — nothing goes cold; one bucketing rule set
  (`lib/engine.ts followUpQueue`) shared by the screen and the push-nudge cron.

## How it works
- **Storage**: per-user data lives on-device (localStorage) AND syncs to the
  user's own row in Supabase (`lite_state` JSONB; RLS `auth.uid() = user_id`).
  Sign-out wipes the device, cloud copy stays. See `lib/store.tsx`.
- **Auth + billing**: Supabase auth; Stripe subscription verified server-side
  (`lib/entitlement.ts`) — every paid AI route gates on it and fails closed.
- **AI**: Anthropic API (Claude) for EILA chat, pay-plan parsing, statement
  and recap scanning. Server routes only; no keys in the client.
- **Pay math** is tested code (`npx vitest run` — 260+ tests). It changes
  through the deploy pipeline, never through chat.

## Run
```bash
npm install
npm run dev   # http://localhost:3000
npx vitest run && npx tsc --noEmit
```
Deploys to production on push to `main` (Vercel).
