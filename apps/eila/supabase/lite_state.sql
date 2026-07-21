-- Mission OS Lite — per-user application state (profile, pay plan, every
-- deal). The single most important table in the app: every real user's real
-- data lives here.
--
-- This table already exists live and its RLS policy was verified directly in
-- the Supabase dashboard on July 4, 2026 — this file exists only to give it
-- the same documented record every other table in this repo has (an audit on
-- July 5 flagged that it was the one table with no .sql on record, even
-- though the live policy itself was already correct). Safe to run again:
-- `create table if not exists` / `create policy` will no-op if these already
-- match what's live.

create table if not exists public.lite_state (
  user_id     uuid primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.lite_state enable row level security;

-- Every user can read and write ONLY their own row — verified live: the
-- actual policy uses auth.uid() = user_id on both the USING (read) and WITH
-- CHECK (write) clauses, applied to every command (select/insert/update/delete).
drop policy if exists "own state" on public.lite_state;
create policy "own state" on public.lite_state
  for all
  to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
