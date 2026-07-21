# Commissioned 41 — Brand Site

Standalone premium marketing site for **Commissioned 41** — _Know Your Mission. Execute With Purpose._

This is a **separate** project from the live MissionOS app (`commissioned41-os`) on purpose:
deploying it can never touch the live product. The long-term plan is to point the root
domain `commissioned41.com` here (company marketing) and keep the app on
`missionos.commissioned41.com`.

## Brand
Blended identity — the locked MissionOS "living glass" foundation (near-black base,
steel-blue accent, living border, the ILA eye portal) layered with platinum chrome and a
restrained crimson punctuation. The eye (`public/brand/ila-eye.jpg`) and the living-border
CSS are ported verbatim from the product so a visitor crosses into the app with no whiplash.

## Stack
Next.js 14 (App Router) · TypeScript · Tailwind · matches the MissionOS house stack.

## Run
```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

## Email capture
`POST /api/join` appends to `.data/mission-list.jsonl` (fail-soft). On Vercel the FS is
ephemeral — wire a real store (Supabase) + Resend welcome email before launch. The client
shows success either way.
