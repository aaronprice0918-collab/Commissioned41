import type { NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { isOwnerEmail, normalizeAccessRole, type AccessRole } from "@/lib/access";
import { samePerson } from "@/lib/data";
import { DEFAULT_ORG_ID } from "@/lib/orgs";

// Shared authorization for the two customer-document endpoints (jacket PDFs and
// license/insurance images). Both used to gate on the org prefix ALONE, which
// let any member of a store pull another rep's customer PII (SSN on the credit
// app, driver's license, insurance) just by knowing the deal/lead id — the ids
// and jacket paths already ride in the store payload every rep receives. These
// helpers add the SAME per-rep ownership rule the CRM screens enforce
// (app/api/store/[key]/route.ts filterForUser): a deal jacket is owned by its
// salesperson (Sales/BDC own-only; managers/F&I/admin any); a lead's docs follow
// the leads screen (only Sales is restricted to their own book).

export type DocCaller = {
  supabase: ReturnType<typeof getSupabaseServerClient>;
  orgId: string | null;
  role: AccessRole;
  employeeName: string;
  email: string;
};

// Resolve the caller to org + role + employee name (not just org). Mirrors
// resolveCaller in the CRM route: a valid token with no profile row is NOT
// defaulted into a real org (owner is the sole exception).
export async function resolveDocCaller(request: NextRequest): Promise<DocCaller> {
  const supabase = getSupabaseServerClient();
  const blank: DocCaller = { supabase, orgId: null, role: "Sales", employeeName: "", email: "" };
  if (!supabase) return { ...blank, supabase: null };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return blank;
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return blank;
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("org_id, role, employee_name, display_name")
    .eq("id", data.user.id)
    .maybeSingle();
  const email = data.user.email || "";
  const owner = isOwnerEmail(email);
  const orgId = (profile?.org_id as string | undefined) || (owner ? DEFAULT_ORG_ID : null);
  const role: AccessRole = owner ? "Admin" : normalizeAccessRole(profile?.role);
  const employeeName = String(profile?.employee_name || profile?.display_name || "");
  return { supabase, orgId, role, employeeName, email };
}

// Managers/F&I/admin may open any deal's jacket (F&I owns the credit app).
// Sales AND BDC are restricted to deals they sold — same as the deals screen,
// which redacts customer PII on non-owned deals for both roles.
export function canAccessDeal(role: AccessRole, employeeName: string, deal: { salesperson?: string } | null): boolean {
  if (role === "Admin" || role === "Manager" || role === "F&I") return true;
  const name = employeeName.trim();
  const seller = String(deal?.salesperson || "").trim();
  if (!name || !seller || !deal) return false; // fail closed on blanks
  return samePerson(seller, name);
}

// A lead's on-file docs follow the leads screen: only Sales is scoped to its own
// book; BDC/F&I/Manager/Admin see the whole store's leads.
export function canAccessLead(role: AccessRole, employeeName: string, lead: { salesperson?: string } | null): boolean {
  if (role !== "Sales") return true;
  const name = employeeName.trim();
  const seller = String(lead?.salesperson || "").trim();
  if (!name || !seller || !lead) return false; // fail closed on blanks
  return samePerson(seller, name);
}

// Load a single deal / lead by id from the org's store, to authorize against it.
export async function findDealById(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  orgId: string,
  dealId: string,
): Promise<{ salesperson?: string } | null> {
  const { data } = await supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", "deals").maybeSingle();
  const deals = Array.isArray(data?.value) ? (data!.value as Array<{ id?: string; salesperson?: string }>) : [];
  return deals.find((d) => String(d.id) === String(dealId)) || null;
}

export async function findLeadById(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  orgId: string,
  leadId: string,
): Promise<{ salesperson?: string } | null> {
  const { data } = await supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
  const leads = Array.isArray(data?.value) ? (data!.value as Array<{ id?: string; salesperson?: string }>) : [];
  return leads.find((l) => String(l.id) === String(leadId)) || null;
}
