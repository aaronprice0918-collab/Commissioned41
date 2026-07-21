-- Mission OS Lite — shared-store rate limiting for the AI-cost-bearing
-- routes (chat, reflect, scan-recap, scan-license, parse-payplan). Replaces
-- the old per-instance in-memory Map, which reset on every cold start and
-- didn't share counts across concurrent serverless instances — meaning the
-- limit was never actually enforced globally on Vercel (July 5 audit finding).
--
-- Run once in the Supabase SQL editor (or via the service-role key). Until
-- this exists, lib/rateLimit.ts falls back to the old in-memory behavior —
-- nothing breaks in the meantime.

create table if not exists public.lite_rate_limits (
  key          text primary key, -- "<route>:<email>:<window bucket>"
  count        int not null default 1,
  window_start timestamptz not null default now()
);

alter table public.lite_rate_limits enable row level security;

-- Atomic increment-and-return, so concurrent requests in the same window
-- can't race each other into under-counting.
create or replace function public.lite_rate_limit_hit(p_key text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.lite_rate_limits (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set count = lite_rate_limits.count + 1
  returning count into v_count;
  return v_count;
end;
$$;

-- The function is SECURITY DEFINER and only ever called with the service-role
-- key from server routes. Postgres grants EXECUTE to PUBLIC by default, which
-- exposed it to the anon role through PostgREST RPC — anyone with the public
-- anon key could spin the counter (July 8 audit). Lock it to the service role.
revoke execute on function public.lite_rate_limit_hit(text) from public;
revoke execute on function public.lite_rate_limit_hit(text) from anon;
revoke execute on function public.lite_rate_limit_hit(text) from authenticated;
grant execute on function public.lite_rate_limit_hit(text) to service_role;
