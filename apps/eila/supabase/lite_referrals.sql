-- Mission OS Lite — referral program ("invite a colleague, you both get a
-- free month"). Two tables:
--   lite_referrals: one row per user who has generated their own share code.
--   lite_referral_redemptions: one row per successful conversion through a
--     code — capped at ONE per referred email, ever, so a code can't be
--     replayed for repeat rewards.
--
-- Run once in the Supabase SQL editor (or via the service-role key).

create table if not exists public.lite_referrals (
  code            text primary key,
  referrer_email  text not null,
  created_at      timestamptz not null default now()
);

-- Rewards are deferred ~24h (see /api/cron/referral-rewards) rather than
-- credited synchronously in the webhook — Aaron's call (July 5 audit): a
-- referred signup that gets disputed/refunded same-day shouldn't have
-- already paid out the referrer. `referrer_email` is denormalized here (off
-- the code at insert time) so the cron's per-referrer 12-month cap check
-- doesn't need a join. `processed_at` is set the moment the cron decides
-- either way (credited or declined) so a declined row is never retried.
create table if not exists public.lite_referral_redemptions (
  id              uuid primary key default gen_random_uuid(),
  code            text not null references public.lite_referrals(code),
  referred_email  text not null unique,
  referrer_email  text,
  rewarded_at     timestamptz,
  processed_at    timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.lite_referral_redemptions add column if not exists referrer_email text;
alter table public.lite_referral_redemptions add column if not exists processed_at timestamptz;

-- Server-only tables, same posture as lite_entitlements: RLS on, zero
-- policies. Only the service-role key (referral code + checkout + webhook
-- routes) ever touches these — never exposed to the browser client directly.
alter table public.lite_referrals enable row level security;
alter table public.lite_referral_redemptions enable row level security;
