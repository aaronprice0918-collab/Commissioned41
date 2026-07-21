# Commissioned 41 OS — Go-Live Runbook

Target: live in-store on **Friday**. Hosting: **Vercel + Supabase** (the only path
with real login and role security — the local/Wi-Fi file-store path has no
authentication and must not be used with real customer or pay data).

---

## Status

| Area | State |
|------|-------|
| Production build | ✅ Passes clean (22 routes, types + lint green) |
| Security hardening | ✅ PII redaction, prod file-store lockout, data untracked (branch `launch-prep`) |
| Doc fee ($899) | ✅ Counts toward store gross, excluded from sales pay, editable/removable per deal |
| Auth + roles model | ✅ Server-enforced from Supabase token; owner assigns roles in Admin |
| Supabase project | ⛔ **Needs creating (you, ~10 min)** — the one blocker |
| Vercel project | ⛔ Not created yet — I deploy once Supabase keys exist |

---

## Critical path

```
[You] Create Supabase project + run schema  →  give me the 3 keys + owner email
   →  [Me] Set Vercel env + deploy  →  [Me] Seed store data
   →  [You+Owner] Create staff logins + assign roles  →  [Both] Smoke test  →  LIVE
```

---

## Step 1 — Create the Supabase project  (YOU, ~10 min)

1. Go to https://supabase.com → **New project**. Name it `commissioned41`. Pick a
   strong DB password and the closest region. Wait for it to finish provisioning.
2. Open **SQL Editor** → paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql)
   → **Run**. (Creates `app_store` + `user_profiles` with row-level security.)
3. Open **Project Settings → API** and copy these three values:
   - **Project URL**  → `NEXT_PUBLIC_SUPABASE_URL`
   - **publishable key** (`sb_publishable_…`)  → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - **service_role secret**  → `SUPABASE_SERVICE_ROLE_KEY`  ⚠️ secret — never put in the browser/`NEXT_PUBLIC_*`
4. Send me the URL + publishable key, and **the email you'll sign in as** (owner).
   Send the service_role secret through the Vercel dashboard yourself if you'd
   rather not paste it in chat — see Step 2.

## Step 2 — Wire env + deploy  (ME, once I have keys)

- Set all 5 env vars on the Vercel project (Production):
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_OWNER_EMAIL`, `NEXT_PUBLIC_OWNER_EMAILS` (optional).
- Merge `launch-prep` → `main`, deploy to Vercel, confirm the build succeeds and the
  login screen loads (no "secure login is not connected" banner).

## Step 3 — Seed the store's current data  (ME)

With the keys in a local `.env.local`:
```bash
npm run seed:supabase
```
Pushes current deals, team, pay plans, goals, RDR/messages from `data/*.json` into
Supabase. (Run once. Re-running overwrites those keys.)

## Step 4 — Create staff logins + assign roles  (YOU + OWNER)

1. Supabase → **Authentication → Users → Add user** for each employee (email +
   temporary password). Owner signs in with the `NEXT_PUBLIC_OWNER_EMAIL` account.
2. Owner opens **Admin → Owner Access Control** and sets each person's role
   (Sales / BDC / F&I / Manager / Admin) and employee name. Roles take effect immediately.
   New users default to **Sales** (least privilege) until changed.

## Step 5 — Smoke test before announcing  (BOTH)

- [ ] Owner login → can reach Admin, assign roles, see all deals
- [ ] A Sales login → sees Mission Control + own scorecard; **cannot** open Admin/GM/Finance
- [ ] Sales user cannot see other reps' customer names on the deals data (PII redaction)
- [ ] Enter a test deal in Deal Entry → appears on Mission Control + scorecards
- [ ] Doc fee: new deal shows $899 in store gross, $0 effect on the salesperson's pay;
      set Doc Fee to 0 on a special-case deal and confirm gross drops by 899
- [ ] Pay numbers on a known deal match the manager's expected math
- [ ] Sign out works; signed-out users hit the login screen (except `/card/*`)

---

## After launch (not blockers)

- **Rotate** the old Supabase publishable key that leaked in git history (commits
  `3059789`, `5517faf`). The fresh project avoids reusing it; rotate to be safe.
- Optionally purge the old `data/*.json` and key from git history (`git filter-repo`).
- Visual redesign (grouped sidebar nav, real display font, metric cards, calmer
  surfaces, higher text contrast) — staged plan ready; do post-launch.
