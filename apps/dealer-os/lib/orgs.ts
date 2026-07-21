// Multi-tenancy: every row in app_store belongs to an organization (a dealership
// tenant). The server resolves the caller's org from their profile — never from
// client input — so one dealership can never read or write another's data.

// The first/default org (Kennesaw Mazda). Existing single-tenant data is
// backfilled to this id by migration 0004. Company-level/owner data also lives
// here until a dedicated company org is split out.
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

// Resolve the org_id for an authenticated user from user_profiles.
export async function resolveOrgId(supabase: any, userId?: string | null): Promise<string> {
  if (!supabase || !userId) return DEFAULT_ORG_ID;
  const { data } = await supabase.from("user_profiles").select("org_id").eq("id", userId).maybeSingle();
  return data?.org_id || DEFAULT_ORG_ID;
}
