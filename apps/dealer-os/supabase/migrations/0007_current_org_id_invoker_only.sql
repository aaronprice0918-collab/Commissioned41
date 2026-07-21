-- 0007_current_org_id_invoker_only.sql
-- SOC 2 audit 2026-07-18 — close the last Supabase security advisory (WARN):
-- current_org_id() is SECURITY DEFINER and was still callable by `authenticated`
-- via /rest/v1/rpc/current_org_id. The app NEVER calls it as an RPC (it's used
-- only inside the app_store RLS policy, which `authenticated` can no longer reach
-- after 0005 revoked app_store grants). The only authenticated-reachable table,
-- user_profiles, uses `auth.uid() = id` and does not reference this function.
-- Verified on staging: revoking EXECUTE from authenticated leaves the login read
-- intact. Fully remove the RPC surface.
revoke execute on function public.current_org_id() from authenticated;

-- Rollback: grant execute on function public.current_org_id() to authenticated;
