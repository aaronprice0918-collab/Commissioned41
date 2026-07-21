-- Commissioned 41 — multi-tenant isolation proof (run on STAGING).
-- Proves, at the database level, that one dealership (org) cannot see another's
-- data — enforced by Postgres Row-Level Security, not just app code.

create extension if not exists "pgcrypto";

-- Dealerships / tenants.
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Which users belong to which org.
create table if not exists org_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  role text not null default 'member',
  primary key (user_id, org_id)
);

-- Org-scoped key/value store (mirrors the app's app_store, but per-tenant).
create table if not exists tenant_store (
  org_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz default now(),
  primary key (org_id, key)
);

-- The calling user's org, resolved from their JWT. SECURITY DEFINER so it can
-- read org_members regardless of RLS.
create or replace function current_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid() limit 1
$$;

alter table organizations enable row level security;
alter table org_members enable row level security;
alter table tenant_store enable row level security;

-- A user sees only their own org, their own membership, and only their org's data.
drop policy if exists org_select on organizations;
create policy org_select on organizations for select
  using (id = current_org_id());

drop policy if exists member_select on org_members;
create policy member_select on org_members for select
  using (user_id = auth.uid());

drop policy if exists tenant_rw on tenant_store;
create policy tenant_rw on tenant_store for all
  using (org_id = current_org_id())
  with check (org_id = current_org_id());
