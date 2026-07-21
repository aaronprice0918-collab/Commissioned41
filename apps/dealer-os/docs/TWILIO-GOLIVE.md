# Twilio Go-Live Runbook

*Prepped July 12, 2026, while Twilio's 24–48h review is pending. When the
account is approved, this whole page is ~5 minutes of work. Everything in the
app is already built and inert — no code changes needed on go-live day.*

## What's waiting on this
One registration unlocks customer texting across **three departments**:
sales (first-touch drafts, EILA `text_customer`, lead threads), service
(status updates, re-promises, win-back texts), parts (SOP pickup texts),
plus the GM's Monday digest. Until then every draft has a "copy to your
phone" path, so nothing is blocked — just manual.

## Step 1 — Buy the number
Twilio Console → Phone Numbers → Buy: one **local** (770/678) number with
SMS. This becomes the store's texting identity.

## Step 2 — A2P 10DLC registration (the part carriers reject people for)
Console → Messaging → Regulatory Compliance. Register the **Brand** with the
LLC's real details (Commissioned 41 LLC / EIN / commissioned41.com). Then the
**Campaign** — use these answers, they match what the app actually sends:

- **Use case:** `Customer Care` (or Mixed if adding marketing later — start
  Customer Care; it approves faster).
- **Campaign description:**
  > Kennesaw Mazda uses this number for one-to-one customer service
  > messages: responses to sales inquiries customers submitted, vehicle
  > service status updates, parts-arrival notifications, and appointment
  > coordination. Messages are individually composed or approved by an
  > employee. Customers opt in verbally or in writing at the dealership or
  > by submitting an inquiry; every conversation supports STOP opt-out.
- **Opt-in description:**
  > Customers provide their mobile number and consent when submitting a
  > vehicle inquiry (web/phone/showroom), scheduling service, or ordering
  > parts. Consent is recorded per customer with a timestamped audit trail
  > before any text is sent. First outbound message includes "Reply STOP
  > to opt out." STOP immediately blocks the number account-wide.
- **Opt-in type:** Verbal + Web form.
- **Sample messages** (pulled from the app's real templates):
  1. `Hi Sarah, this is Aaron at Kennesaw Mazda — saw your note on the 2024 CX-5. Is evening or morning better for a quick call? Reply STOP to opt out.`
  2. `Hi Omar, it's Kennesaw Mazda — quick update: your 2021 Mazda3 is in the shop being worked on now. We're still on track for 4:30 PM. I'll keep you posted.`
  3. `Hi Dana, it's the parts department at Kennesaw Mazda — good news, your roof rack cross bars just arrived. Come by any time and we'll take care of you.`
  4. `Hi Gail, it's the service team at Kennesaw Mazda. When your CX-9 was in, we noted: rear brakes at 3mm. No pressure — want me to get you a time this week?`
  5. `Hi Nina, it's Kennesaw Mazda with an honest update on your CX-50 — it's taking longer than we promised and I'm sorry about that. I'll text you a firm time within the hour.`
- **Volume:** Low (< 2,000/day).
- **Embedded links / phone numbers:** No links; may include the store's phone number.

## Step 3 — Point the webhook at the app
Number → Messaging Configuration → "A message comes in":
`https://missionos.commissioned41.com/api/sms/webhook` — HTTP **POST**.
(Inbound replies land on the right customer, STOP auto-revokes consent,
and the tenant is resolved from the To number.)

## Step 4 — Vercel env (Project → Settings → Environment Variables)
- `TWILIO_ACCOUNT_SID` — from Console home
- `TWILIO_AUTH_TOKEN` — from Console home
- `TWILIO_FROM_NUMBER` — the new number in E.164 (`+1770…`), founding-store fallback
Redeploy after saving (any push, or "Redeploy" in Vercel).

## Step 5 — Per-store rows (ask Claude — one SQL each)
- `commsConfig.fromNumber` — the store's own number (multi-tenant send/receive)
- `commsConfig.digestTo` — Aaron's cell for the Monday 7am Fixed Ops digest

## Step 6 — Prove it (5 taps)
1. Store Settings → **Texting** card shows green "Connected".
2. Pick a test lead (your own number), capture text consent on the card.
3. Send from the thread — first message carries the STOP notice.
4. Reply from the phone → lands in the thread; reply STOP → chip flips red.
5. Ask EILA to "text <the test customer>" — preview, confirm, delivered.

## If the campaign gets rejected
Usual causes: opt-in description too vague, or sample messages that read as
marketing blasts. The answers above are written to avoid both. Resubmit with
tighter wording — rejections aren't permanent.
