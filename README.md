# Commissioned 41 — Monorepo

One repo, every product.

## Apps

| App | Directory | Description | Deploy |
|-----|-----------|-------------|--------|
| **Dealer Mission OS** | `apps/dealer-os` | Multi-tenant dealership operating system | `missionos.commissioned41.com` |
| **EILA** | `apps/eila` | AI assistant for commission auto-sales reps | Separate Vercel project |
| **MissionOS Finance** | `apps/finance` | AI-powered personal finance OS | Separate Vercel project |
| **Brand Site** | `apps/site` | Commissioned 41 marketing/brand site | `commissioned41.com` |

## Shared Packages

| Package | Directory | Description |
|---------|-----------|-------------|
| `@commissioned41/ila-core` | `packages/ila-core` | EILA's identity, personality, and shared brain — one source of truth across all products |
| `@commissioned41/tsconfig` | `packages/tsconfig` | Shared TypeScript configuration |

## Getting Started

```bash
# Install everything (root + all apps + packages)
npm install

# Run a specific app in dev
npx turbo dev --filter=@commissioned41/eila

# Run all apps
npx turbo dev

# Build everything
npx turbo build

# Run tests
npx turbo test

# Lint
npx turbo lint
```

## Architecture

```
commissioned41/
├── apps/
│   ├── dealer-os/      ← Next.js 16 + Supabase (multi-tenant)
│   ├── eila/           ← Next.js 16 + Supabase (single-user)
│   ├── finance/        ← Next.js 16 + Prisma/Neon
│   └── site/           ← Next.js 14 + static (upgrade planned)
├── packages/
│   ├── ila-core/       ← EILA's shared brain + personality
│   └── tsconfig/       ← Shared TS config
├── turbo.json          ← Turborepo pipeline config
└── package.json        ← Workspace root
```

Each app deploys independently to its own Vercel project. Shared packages are
linked via npm workspaces — a change to `ila-core` is instantly available in
every app without publishing.

## Key Principle

> "One bag of Doritos should taste like another bag of Doritos." — Aaron

EILA is one brain. Her identity, personality, and craft knowledge live in
`packages/ila-core`. Each app provides its own domain tools and user data on
top of this shared core.
