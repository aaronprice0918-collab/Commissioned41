-- 0006_lockdown_tenant_tables.sql
-- SOC 2 audit 2026-07-18 — tenant-table hardening (follows 0005 which locked
-- app_store). All changes proven on COMMISSIONED41-staging first; the app reaches
-- these tables only via the service-role server client, and the browser's only
-- direct read is a user's OWN user_profiles row (login), which is preserved.

-- M-10: current_org_id() is SECURITY DEFINER and was callable by anon via
-- /rest/v1/rpc/current_org_id. Close the anonymous RPC surface. `authenticated`
-- keeps EXECUTE (it only ever returns the caller's own org, and the app_store
-- RLS policy references it) — but app_store direct access is already revoked in
-- 0005, so this is purely closing the anon endpoint.
revoke execute on function public.current_org_id() from anon, public;

-- L-5: user_profiles.org_id was nullable, and privileged routes fell back to the
-- founding org on a null (a null-org admin would silently become a Kennesaw
-- admin). Prod has zero null org_ids; make it structurally impossible.
update public.user_profiles set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.user_profiles alter column org_id set not null;

-- Defense-in-depth: organizations already had RLS enabled with no policy (deny),
-- and the app reads it only via the service role. Revoke the browser-facing
-- grants too so the tenant table is fully server-only, matching app_store.
revoke all on public.organizations from authenticated, anon;

-- Rollback (only if something unexpected breaks):
--   grant execute on function public.current_org_id() to authenticated;  -- (anon left revoked)
--   alter table public.user_profiles alter column org_id drop not null;
--   grant select on public.organizations to authenticated;
