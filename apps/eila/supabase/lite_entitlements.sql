-- Mission OS Lite — entitlements table.
-- The Stripe webhook (/api/stripe/webhook) writes one row per billing email with
-- the current subscription status. The server-side entitlement check reads it
-- first (fast, single indexed row) before falling back to a live Stripe lookup.
--
-- Run once in the Supabase SQL editor (or via the service-role key).

create table if not exists public.lite_entitlements (
  email               text primary key,
  status              text not null,            -- raw Stripe status: active/trialing/past_due/canceled/...
  entitled            boolean not null default false, -- derived: active||trialing
  stripe_customer_id  text,
  current_period_end  timestamptz,
  updated_at          timestamptz not null default now(),
  event_created       timestamptz               -- the Stripe *event's* created time (not our write time) —
                                                  -- lets the webhook refuse to let a stale/reordered retry
                                                  -- overwrite a status a newer event already set (July 5 audit)
);

alter table public.lite_entitlements add column if not exists event_created timestamptz;

-- Server-only table. Enable RLS and define NO policies: anon and authenticated
-- users get zero access, while the service-role key (used only by the webhook
-- and the entitlement read on the server) bypasses RLS. Defense in depth — even
-- if this table were ever queried from the browser client, it returns nothing.
alter table public.lite_entitlements enable row level security;
