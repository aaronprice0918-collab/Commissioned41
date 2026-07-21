# Commissioned 41, LLC — Incident Response Plan

**Version 1.0 · July 6, 2026 · Incident Commander: Aaron Price (all roles until there are employees)**
Print this. When something is wrong, follow it top to bottom — don't improvise under stress.

## What counts as an incident
Suspected or confirmed: unauthorized access to customer data; leaked/committed credential; lost or stolen device holding production access; vendor breach notice (Supabase/Vercel/Anthropic/Stripe/ElevenLabs); ransomware/malware on a machine with production access; a bug that exposed one tenant's data to another; extortion or a credible vulnerability report.

## First hour
1. **Write down the time** and what you observed. Start a running log (timestamps, actions, evidence). Screenshots > memory.
2. **Contain — cut credentials, not evidence:**
   - Rotate the exposed credential first (Supabase service keys → Dashboard → Settings → API; Vercel/GitHub/Stripe/Anthropic tokens likewise).
   - Supabase: Auth → sign out all sessions for affected users if account takeover is suspected.
   - If a laptop is lost/stolen: rotate EVERYTHING it held (see `RUNBOOK-KEYS-MFA.md` inventory) and remotely lock/wipe via Find My.
   - Do NOT delete logs, rows, or files — preserve them.
3. **Stop the bleeding in the app** if a code path is leaking: revert the deploy on Vercel (Deployments → previous → Promote) — reverting beats debugging live.

## First day
4. **Scope it:** which tables/rows/orgs, which time window, which credential or bug. Supabase logs + Vercel logs are the primary evidence. Save copies outside the affected systems.
5. **Classify:**
   - **A — Consumer NPI exposed** (deal customers' names + finance details, license data): breach-notification duties likely apply.
   - **B — Dealership/internal data only** (comp plans, goals): contract/customer-trust duty, notify the affected dealership.
   - **C — No data exposure** (attempt, contained credential leak): fix, log, move on.
6. **For class A, engage counsel before external statements.** Georgia breach-notification law and the laws of each affected consumer's state apply; the FTC Safeguards Rule requires notifying the FTC within **30 days** for breaches involving **500+ consumers'** unencrypted information (ftc.gov reporting portal). Dealership contracts may require prompt notice regardless of count — check them.
7. **Notify affected dealerships honestly and fast** — what happened, what data, what we did, what they should do. (The trust standard of this company: say the true thing early.)

## First week
8. Remediate root cause; add a regression test where applicable (pattern: every July 6 money bug got a permanent test).
9. Post-incident review, written: timeline, cause, blast radius, what worked, what changes (policy, code, vendor). File it in `security/incidents/YYYY-MM-DD-name.md`.
10. Update `RISK-ASSESSMENT.md` if the incident revealed a new or mis-scored risk.

## Contacts
- Aaron Price — Incident Commander — aaronprice0918@gmail.com
- Counsel: ☐ TODO — identify a data-breach attorney BEFORE one is needed (bar referral or insurer panel)
- Cyber insurance: ☐ TODO — none currently; get a quote (often bundled with general liability)
- Vendor security: Supabase support (dashboard), Vercel support, Anthropic (usersafety@anthropic.com), Stripe dashboard, ElevenLabs support
- FTC breach reporting: https://www.ftc.gov (Safeguards Rule event reporting)

## Notification template (dealership)
> On [date] we identified [what]. The affected data was [scope]. We have [containment/rotation/fix]. We recommend [actions]. We will follow up by [date] with the full findings. — Aaron Price, Commissioned 41
