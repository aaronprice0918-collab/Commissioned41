-- Mission OS Lite — push notification subscriptions.
-- One row per user's device (v1: one device per user, upsert on resubscribe).
-- Populated by /api/push/subscribe, read + updated by the daily nudge cron
-- (/api/cron/nudges) via the service-role key.
--
-- Run once in the Supabase SQL editor (or via the service-role key).

create table if not exists public.lite_push_subscriptions (
  user_id           uuid primary key,
  endpoint          text not null,
  p256dh            text not null,
  auth_key          text not null,
  -- Anti-spam: at most one nudge per user per day. Set by the cron job right
  -- after a successful send; compared as a plain date, not a timestamp.
  last_nudged_date  date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Server-only table, same posture as lite_entitlements: RLS on, zero policies.
-- Only the service-role key (subscribe/unsubscribe routes + the cron job) ever
-- touches this table — never exposed to the browser client directly.
alter table public.lite_push_subscriptions enable row level security;
