-- Multi-tenant retrofit for the real app: scope app_store to an organization.
-- Idempotent and safe to run on the empty STAGING db and (later) on PROD, which
-- already has Kennesaw's single-tenant data. On prod, existing rows are backfilled
-- into a default "Kennesaw Mazda" org so nothing breaks.

create extension if not exists "pgcrypto";

-- Base tables (no-ops on prod where they already exist; created on staging).
create table if not exists public.app_store (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'Sales',
  employee_name text,
  created_at timestamptz not null default now()
);
alter table public.app_store enable row level security;
alter table public.user_profiles enable row level security;

-- 1) Organizations (tenants).
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.organizations enable row level security;

-- 2) The default org for existing single-tenant data: Kennesaw Mazda (fixed id).
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Kennesaw Mazda')
on conflict (id) do nothing;

-- 3) Tie users to an org; existing users default to Kennesaw Mazda.
alter table public.user_profiles add column if not exists org_id uuid references public.organizations(id);
update public.user_profiles set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;

-- 4) Scope app_store to an org: add org_id, backfill, make composite key (org_id, key).
alter table public.app_store add column if not exists org_id uuid references public.organizations(id);
update public.app_store set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.app_store alter column org_id set not null;
alter table public.app_store drop constraint if exists app_store_pkey;
alter table public.app_store add primary key (org_id, key);

-- 5) Caller's org, from their profile (security definer so it reads under RLS).
create or replace function public.current_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select org_id from public.user_profiles where id = auth.uid() limit 1
$$;

-- 6) Defense-in-depth RLS backstop. The app reads/writes app_store ONLY through
--    the server (service role, which bypasses RLS) and scopes by org in code; this
--    policy just ensures any direct authenticated access is org-scoped too.
drop policy if exists app_store_tenant on public.app_store;
create policy app_store_tenant on public.app_store for all to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists users_read_own_profile on public.user_profiles;
create policy users_read_own_profile on public.user_profiles for select to authenticated
  using (auth.uid() = id);
