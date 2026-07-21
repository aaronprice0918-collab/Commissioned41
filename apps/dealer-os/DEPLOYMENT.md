# Commissioned 41 OS Access Plan

## Immediate Store Access

Use this for a same-store pilot when everyone is on the same Wi-Fi/network.

1. Start the app on the main dealership computer:

```bash
npm run build
npm run start:store
```

2. Find that computer's local IP address.

On Mac:

```bash
ipconfig getifaddr en0
```

3. Give employees this link, replacing the IP:

```text
http://YOUR-IP-ADDRESS:3000
```

Example:

```text
http://192.168.1.50:3000
```

Keep the main computer awake and keep the Terminal window running.

## What Is Shared

When the app is running from one main computer, these are shared through the app server:

- Deal records
- RDR status
- Admin people lists
- Lienholders / banks
- Pay plans
- Private messages

## Privacy Note

The current system supports private views in the interface. Before wider hosted rollout, add real user login, password reset, role permissions, and a managed database.

## Hosted Rollout

Use this for access outside the store network:

- Hosting: Vercel or similar
- Database: Supabase, Neon, or Postgres
- Login/auth: email/password or Microsoft/Google login
- Roles: Admin, Sales, Manager, F&I, BDC
- Data migration from `.data/*.json` into the database

## Supabase Setup

> **Production DB (authoritative):** project ref **`wwwibdjgabicenvpmivy`** (COMM41) — this is
> the live multi-tenant DB (`organizations`, `current_org_id()`, per-org `app_store`). Staging is
> `whboyuuvmqcfytqtvoap` (COMMISSIONED41-staging). The older `djnvkypjswtwqzuysmxg` project is the
> pre-multitenancy DB and is **retired** — do not point new deploys at it. (Corrected 2026-07-18 per
> the SOC 2 audit config-drift finding.)

Project URL:

```text
https://wwwibdjgabicenvpmivy.supabase.co
```

1. Open Supabase SQL Editor.
2. Run `supabase/schema.sql`.
3. Go to Project Settings > API.
4. Copy:
   - Project URL
   - publishable key
   - service_role secret key

Add these to Vercel Environment Variables:

```text
NEXT_PUBLIC_SUPABASE_URL=https://wwwibdjgabicenvpmivy.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Seed Current Store Data

After environment variables are available locally:

```bash
npm run seed:supabase
```

This pushes current deals, RDR status, admin lists, pay plans, and messages to Supabase.

## Vercel Setup

1. Push or import this project into Vercel.
2. Select the `commissioned41-os` folder as the project root if needed.
3. Add the three Supabase environment variables above.
4. Deploy.
5. In Supabase Authentication, create users for the store team.
