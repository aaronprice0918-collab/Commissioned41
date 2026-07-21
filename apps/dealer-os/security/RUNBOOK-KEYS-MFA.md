# Runbook — Key Rotation & MFA Hardening (Aaron's hands required)

**Created July 6, 2026.** Work top to bottom; check boxes as you go. Total time ≈ 1–2 hours. Do the rotations at a quiet hour — each Supabase service-key rotation needs an immediate Vercel env update + redeploy or the app's server routes lose database access.

## Why now
Both production Supabase **service-role keys** (dealer + lite) live in plaintext `.env.local` files on the laptop and were used for admin operations (including by AI agent sessions). They are the master keys to all customer data. Rotating them and enforcing MFA everywhere closes the two HIGH risks in `RISK-ASSESSMENT.md`.

## Part 1 — MFA on every provider account  ✅ ALL ACCOUNTS DONE (verified July 7, 2026)
Use an authenticator app (or hardware key). Avoid SMS where possible. Store recovery codes in the password manager.

- ☑ **Email account backing everything** (aaronprice0918@gmail.com) — Google 2-Step Verification **ON since Nov 9, 2021** (verified July 7, 2026). Reset root for all others.
- ☑ **GitHub** (aaronprice0918-collab) — 2FA enabled: **passkey + GitHub Mobile** (verified July 7, 2026).
- ☑ **Vercel** — sign-in is **Continue with Google**, inherits the Google 2-Step above (verified July 7, 2026).
- ☑ **Supabase** — sign-in is **Continue with Google**, inherits the Google 2-Step (verified July 7, 2026).
- ☑ **Stripe** — **Google SSO + authenticator-app code** required at login (verified July 7, 2026).
- ☑ **Anthropic Console** — sign-in is **Continue with Google**, inherits the Google 2-Step (verified July 7, 2026).
- ☑ **Domain registrar for commissioned41.com** — registered through **Vercel Domain Services** (`registrar.vercel.com`), managed in the Vercel account → **Continue with Google**, inherits the Google 2-Step (verified July 7, 2026). ☐ Minor: confirm the domain transfer-lock is on in Vercel domain settings.
- ☑ **ElevenLabs** — sign-in is **Continue with Google**, inherits the Google 2-Step (verified July 7, 2026).

> Note: Supabase/Vercel/Anthropic inherit MFA via Google SSO — valid as long as Google is the *only* sign-in path (no separate password on those accounts). If a password login is ever added, enable that account's own MFA too.

## Part 2 — Password manager (~15 min)
- ☐ Set up 1Password (or Bitwarden). Move every password + recovery code above into it.
- ☐ Create the **Emergency Kit**: master password + a note pointing to this `security/` folder, sealed where a trusted person can reach it if you can't (risk #7, continuity).

## Part 3 — Rotate the Supabase service-role keys (~20 min each, dealer then lite)
For **each** project (dealer, then lite) in the Supabase Dashboard:

1. ☐ Project → Settings → API → **Roll/regenerate the `service_role` key**. (The old key dies immediately.)
2. ☐ Vercel → the matching project → Settings → Environment Variables → update `SUPABASE_SERVICE_ROLE_KEY` → **Redeploy**.
3. ☐ Verify production works: dealer — load CRM Desk + save a note; lite — open the app, confirm data loads (reconcile reads use the anon key client-side, but server routes like entitlements use the service key — test a subscribed action).
4. ☐ Update the master copy in 1Password.
5. ☐ **Delete the `SUPABASE_SERVICE_ROLE_KEY` line from the laptop's `.env.local`.** Local dev doesn't need it day-to-day; when an admin task genuinely requires it, pull it from 1Password for the session and remove it after. (This is the control that turns "any agent on the laptop can touch prod" into "prod access is a deliberate act.")

## Part 4 — Rotate the other tokens (~15 min)
Same pattern (regenerate → update Vercel env → redeploy → 1Password → trim `.env.local`):
- ☐ `ANTHROPIC_API_KEY` (both repos' Vercel projects; keep a **separate low-limit dev key** for the laptop so local ILA dev still works)
- ☐ `STRIPE_SECRET_KEY` + confirm webhook secrets (lite)
- ☐ `ELEVENLABS_API_KEY` (dealer)
- ☐ `VERCEL_TOKEN` in the dealer `.env.local` — regenerate or delete if unused
- ☐ `ILA_BRAIN_KEY` — rotate on both ends (it authenticates the lite↔brain bridge)

## Part 5 — Machine (~10 min)
- ☐ System Settings → Privacy & Security → **FileVault: On**.
- ☐ Auto-lock ≤ 2 min; OS auto-updates on.
- ☐ Find My Mac enabled (remote lock/wipe path in the incident plan).

## Done?
Date completed: __________  → note it in `SECURITY-POLICY.md` §4 and flip the ☐ TODOs there. Next rotation due: **July 2027** or on any suspected exposure.
