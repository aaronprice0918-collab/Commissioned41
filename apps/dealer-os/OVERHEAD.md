# Commissioned 41 — Business Overhead

Running tally of what it costs to run **MissionOS / Commissioned 41**. Kept for
Aaron's accounting (business overhead). Update whenever a cost is added or changes.

_Last updated: June 24, 2026 — real numbers locked in._

## Monthly recurring (fixed overhead — same no matter how many stores)

| Service | What it's for | Cost / mo | Status |
|---|---|---|---|
| **Claude Max** | Building MissionOS (working with me). BUILD cost, not a run cost. | **$100.00** | ✅ Confirmed (Max plan) |
| **Supabase Pro** | Database + logins | **$25.00** | ✅ Confirmed (Pro) |
| **ElevenLabs** | ILA's premium voice (text-to-speech), Creator plan / 131k chars/mo | **$22.00** | ✅ Confirmed — Jun 24, 2026 |
| **Vercel Pro** | Hosting & deploys | **$20.00** | ✅ Confirmed (Pro) |
| **GitHub** | Code backup / repo | **$0.00** | ✅ Free (private repos) |
| **Domain** (commissioned41.com, amortized) | the web address | **~$1.25** | ~$15/yr |
| **FIXED TOTAL** | | **≈ $168/mo** | |
| **Anthropic API (Claude)** | ILA's brain — Opus 4.8, per-use | **usage-based** | ✅ Live. ~10¢/full chat, ~1¢/quick action; caching cut input 70–80%. **Per-store COGS** — scales with floor usage. |

**🔑 Build vs run:** $100 of the $168 is **Claude Max — a BUILD cost.** Once MissionOS
is stable, drop to Claude Pro ($20) or cancel → **steady-state cost to RUN the
platform ≈ $68/mo** (Vercel + Supabase + ElevenLabs + domain) + ILA's Anthropic usage.

## Per-store cost (COGS — what each store consumes)

| Line | Per busy store / mo |
|---|---|
| **ILA's brain (Anthropic/Claude)** | ~$60–130 (caching already cut this 70–80%; a light store is far less) |
| **ILA's voice (ElevenLabs)** | ~$5–30 with **on-demand voice** (tap-to-hear / talk-to-talk). Auto-speak-everything was the budget-killer — that's why it's on-demand. At scale, higher ElevenLabs tiers (Pro $99/500k, Scale $330/2M chars) are cheaper per char. |
| **Infra (Vercel/Supabase usage)** | a few $ |
| **≈ COGS / store** | **~$70–160 (plan ~$100)** |

## Unit economics @ $499/store/mo

- **Store #1 covers ALL fixed overhead** ($168) and still nets ~$331.
- Each store after #1 = only its marginal COGS (~$60–160) → **~$340–440 gross profit each.**
- 5 stores ≈ **$1,800/mo profit** · 20 stores ≈ **$7,800/mo** · **margin climbs with scale** (~73–80%+) as the $168 spreads.
- Stripe takes ~2.9% + 30¢ ≈ **$15** off each $499 charge.
- Net: a genuinely high-margin SaaS — AI + voice are a normal COGS line, not a threat to the model.

## One-time / annual (done)

| Item | Cost |
|---|---|
| Commissioned 41 LLC (formation) | **$110** |
| EIN (federal tax ID) | **$150** |
| commissioned41.com domain | ~$15/yr |
| GA LLC annual registration | ~$50/yr |
| Anthropic API credit top-up (July 1, 2026) | **$50** |

## Added since June 24 (ecosystem grew to 4 products)

| Service | What it's for | Cost / mo |
|---|---|---|
| **Neon Postgres** | MissionOS Finance database | $0 (free tier today; Launch tier ~$19 if it grows) |
| **Plaid** | Finance bank connections | $0 sandbox today; production pricing TBD at the sales call (~July 6) |
| **Stripe (Lite/ILA)** | $19.99 subscriptions | ~2.9% + 30¢ per charge (≈ $0.88 of each $19.99) |
| Supabase "MissionOS Lite" project | ILA app auth + sync | $0 (free tier) — separate from the dealer Pro project |

## Per-transaction / variable

| Service | Cost |
|---|---|
| **Stripe** | No monthly fee. ~2.9% + 30¢ per charge once stores are billed. |

## Bottom line

**Run-the-platform cost ≈ $68/mo** (after the build phase) **+ ILA's Anthropic usage per
store.** One store at $499 pays for everything; every store after is ~75–80% margin.
The levers keeping COGS low: **on-demand voice** (in progress) and **prompt caching** (live).
