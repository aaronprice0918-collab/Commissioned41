# MissionOS Finance

An AI-powered financial operating system — not a budgeting app. It keeps a live
CFO-grade model of your financial life and answers the only questions that
matter: *what's safe to spend, what's coming, and what moves me toward freedom.*

Built for a commission-driven F&I income (variable paychecks, pay-plan-aware
predictions), but the engine is general.

## Status

**Prototype — design-first on realistic mock data.** No external services wired
yet. The full UI and the financial engine are real and working; Plaid/OpenAI/DB
are the next phase.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind CSS v4
- Pure-function financial engine (no backend required to run)

## Run

```bash
npm run dev        # http://localhost:3000
```

## Architecture

```
src/
  lib/
    types.ts       Domain model: accounts, transactions, bills, paychecks, goals
    mockData.ts    A realistic profile (Kennesaw Mazda F&I) — swap for live data
    engine.ts      The CFO brain: safe-to-spend, forecast, health score, brief,
                   decision engine, alerts. All pure, all testable.
    format.ts      Currency / date helpers
  components/
    primitives.tsx AnimatedNumber, Card, Pill, Label, Dot
    HealthRing.tsx Animated SVG health score ring
    Forecast.tsx   Interactive 30-day cash-flow chart
    DecisionEngine.tsx  "Can I afford this?" → hours of work, deals to replace
  app/
    page.tsx       The Mission Dashboard (every widget)
    layout.tsx     Fonts, metadata
    globals.css    Design language: matte black, glass, blue accent
```

### The engine is the product

`engine.ts` turns one `FinancialProfile` into every number on screen:

- **Safe to spend** — cash − bills-before-payday − prorated essentials − buffer,
  spread across the runway to the next deposit.
- **30-day forecast** — day-by-day projected checking balance with bill/income
  events marked.
- **Health score** — weighted 0–100 across emergency fund, cash flow, credit
  utilization, debt load, investments, income stability, net-worth trend.
- **Daily brief** — the morning "you have $X safe, $Y arrives Friday" narrative.
- **Decision engine** — Mission Mode: hours of work, deals-to-replace, goal slip,
  invest-instead comparison.

## Next phase (to make it live)

1. **Plaid** — replace `mockData.ts` with synced accounts/transactions. The
   engine already consumes the `FinancialProfile` shape; only the source changes.
2. **OpenAI** — pay-plan document parsing for commission prediction; natural-language
   brief and "ask EILA" chat.
3. **Prisma + Postgres** — persist profile, learned patterns, goals.
4. **Auth** — Clerk or Firebase.
5. **Learning engine** — seasonality, paycheck/commission trend fitting.

## Design language

Apple-inspired. Matte black, soft gray, white, subtle blue. Glass surfaces,
tabular numerals, smooth count-up and ring animations, reduced-motion aware.
Every screen should feel premium.
