create table if not exists public.app_store (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_store enable row level security;

drop policy if exists "authenticated users can read app store" on public.app_store;

-- App data is intentionally not readable directly from the browser.
-- Reads and writes happen through the Next.js server API using SUPABASE_SERVICE_ROLE_KEY,
-- where pay plans, messages, CRM leads, and other private records are filtered by role.
-- Do not expose the service role key in the browser.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'Sales',
  employee_name text,
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "users can read own profile" on public.user_profiles;
create policy "users can read own profile"
on public.user_profiles
for select
to authenticated
using (auth.uid() = id);
