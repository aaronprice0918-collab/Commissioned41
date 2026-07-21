-- 0005_lockdown_app_store_grants.sql
-- SOC 2 CRITICAL C-1 fix (audit 2026-07-18).
--
-- The 0004 RLS policy `app_store_tenant` scopes app_store access by ORG only
-- (`org_id = current_org_id()`), with no per-KEY or per-ROLE restriction. Because
-- the browser holds a valid Supabase JWT (signInWithPassword) and the anon key
-- ships in the bundle, any authenticated user could hit PostgREST directly
-- (`/rest/v1/app_store?key=eq.payplans`) and read/write EVERY key in their org —
-- bypassing the server's allowedKeys list, the `canWrite` role matrix, and the
-- `filterForUser` PII redaction. In the founding org (19 users across Sales/BDC/
-- F&I/Manager/Admin) that exposes all employee comp (`payplans`) and all customers'
-- unredacted records to the lowest role.
--
-- The app NEVER reads app_store from the browser: every access is server-side via
-- the service-role client (lib/supabaseServer.ts), which bypasses these grants and
-- RLS. So removing direct table access for the browser-facing roles closes the hole
-- with zero app impact. RLS stays enabled as defense-in-depth.
--
-- Proven on COMMISSIONED41-staging (whboyuuvmqcfytqtvoap) before prod:
--   before: authenticated could SELECT/UPDATE/DELETE
--   after : authenticated + anon => permission denied; service_role => still reads.

revoke all on public.app_store from authenticated, anon;

-- Belt-and-suspenders: ensure RLS remains on (it already is from 0004) so any future
-- accidental re-grant still can't cross tenants.
alter table public.app_store enable row level security;

-- The now-redundant permissive policy is intentionally LEFT in place (harmless with
-- no grants) so a future re-grant does not silently reopen cross-KEY access without
-- also re-adding a policy. If you later want authenticated read access to specific
-- non-sensitive keys, replace `app_store_tenant` with key-scoped policies rather than
-- re-granting broadly.

-- Rollback (ONLY if this breaks something unexpected):
--   grant select, insert, update, delete on public.app_store to authenticated;
--   grant select on public.app_store to anon;
