# Commissioned 41 — Monorepo (READ THIS FIRST)

**This is the canonical repo for everything Commissioned 41.** All products were
consolidated here. The old standalone `aaronprice0918-collab/commissioned41-os`
repo is **deprecated** — the dealer product now lives at `apps/dealer-os`. Do all
new work here, never in the old repo.

## Layout

| Path | What | Deploys to |
|------|------|-----------|
| `apps/dealer-os` | Dealer Mission OS — multi-tenant dealership OS (formerly the `commissioned41-os` repo) | `missionos.commissioned41.com` |
| `apps/eila` | EILA — AI assistant for commission auto-sales reps | its own Vercel project |
| `apps/finance` | MissionOS Finance — personal finance OS | its own Vercel project |
| `apps/site` | Marketing / brand site | `commissioned41.com` |
| `packages/ila-core` | EILA's shared identity/brain — one source of truth | — |
| `packages/rate-limit` | `@commissioned41/rate-limit` — Upstash + in-memory fallback limiter | — |
| `packages/tsconfig` | Shared TS config | — |

**Each app has its own `CLAUDE.md`** with product-specific rules (vision, UX laws,
domain logic). Read the relevant app's `CLAUDE.md` before working in it. This root
file covers only monorepo-wide, cross-cutting concerns.

## Commands

```bash
npm install                                   # root + all workspaces
npx turbo build                               # build everything
npx turbo build --filter=@commissioned41/dealer-os   # one app
npx turbo test                                # all tests
cd apps/dealer-os && npm run build            # build a single app directly
```

The production Vercel project for dealer-os runs `turbo run build` scoped to
`@commissioned41/dealer-os`.

## Operational rules — learned the hard way, do not relearn

- **Next.js 16 uses `proxy.ts`, NOT `middleware.ts`.** The framework **errors** if
  both exist in an app. dealer-os already has a `proxy.ts` (host routing + the
  API auth safety net). Add middleware logic *inside* the existing `proxy.ts`;
  never add a `middleware.ts`.
- **Commit the lockfile. Never rely on `^` ranges.** There is a root
  `package-lock.json` — keep it committed and current. A missing lockfile once let
  `stripe` drift from a pinned `22.2.3` to `22.3.2`, whose types demanded a
  different `apiVersion` and **broke the production build**. dealer-os pins
  `stripe` to exact `22.2.3` (client `apiVersion: 2026-05-27.dahlia`, matched to
  the webhook endpoint) — do not loosen it.
- **No app sets `ignoreBuildErrors`/`ignoreDuringBuilds`.** A single TS or lint
  error fails `next build`. Always run the actual `next build` (not just `tsc`)
  for an app before merging anything that deploys.
- **Refactors must be build-verified.** A past "split god file" refactor left a
  truncated function and several dropped imports that failed the build silently
  until deploy. After any multi-file move, run each affected app's `build`.
- **API auth safety net** lives in `apps/dealer-os/proxy.ts` and
  `apps/eila/proxy.ts`: non-public `/api/*` routes must carry an `Authorization`
  header or get `401`. It's defense-in-depth — every route still does its own real
  auth. Add new public routes to that file's allowlist.

## Deploy

Push/merge to `main` deploys each app to its own Vercel project. Production is
judged on the live site, so verify the deploy goes green after merging.
