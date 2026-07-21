import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { isOwnerEmail } from "@/lib/access";
import { groupForViewer, groupRollup, type GroupStoreInput } from "@/lib/groupReport";

// Group Command: the multi-rooftop rollup. Who sees what:
// - The platform owner sees every store (no config needed).
// - A dealer-group principal sees the stores named in a server-only
//   `groupConfig` app_store row ({name, memberOrgIds, viewers}) — the key is
//   deliberately NOT in the store route's allowedKeys, so clients can never
//   read or forge membership; it's seeded by us (SQL/console) per group.
// - Everyone else gets configured:false and the screen explains itself.
// The response is aggregates only — units and gross by store, never customer
// PII — so a group view never widens what a role could see in-store.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ configured: false, reason: "dev" });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData?.user?.email || "";
  if (userError || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let groupName: string;
  let memberOrgIds: string[];

  if (isOwnerEmail(email)) {
    // Platform owner: the whole fleet.
    const { data: orgs } = await supabase.from("organizations").select("id");
    groupName = "All stores";
    memberOrgIds = (orgs ?? []).map((o: any) => String(o.id));
  } else {
    const { data: configs } = await supabase.from("app_store").select("value").eq("key", "groupConfig");
    const group = groupForViewer(configs ?? [], email);
    if (!group) return NextResponse.json({ configured: false });
    groupName = group.name;
    memberOrgIds = group.memberOrgIds;
  }

  if (!memberOrgIds.length) return NextResponse.json({ configured: false });

  const [{ data: orgRows }, { data: dealRows }, { data: settingsRows }] = await Promise.all([
    supabase.from("organizations").select("id, name").in("id", memberOrgIds),
    supabase.from("app_store").select("org_id, value").eq("key", "deals").in("org_id", memberOrgIds),
    supabase.from("app_store").select("org_id, value").eq("key", "storeSettings").in("org_id", memberOrgIds),
  ]);

  const names = new Map<string, string>((orgRows ?? []).map((o: any) => [String(o.id), String(o.name || "Store")]));
  const dealsByOrg = new Map<string, any[]>((dealRows ?? []).map((r: any) => [String(r.org_id), Array.isArray(r.value) ? r.value : []]));
  const settingsByOrg = new Map<string, any>((settingsRows ?? []).map((r: any) => [String(r.org_id), r.value ?? null]));

  const stores: GroupStoreInput[] = memberOrgIds.map((orgId) => ({
    orgId,
    name: names.get(orgId) || "Store",
    deals: dealsByOrg.get(orgId) ?? [],
    // Each store graded on ITS OWN settings (product weights → honest PPU).
    settings: settingsByOrg.get(orgId) ?? null,
  }));

  return NextResponse.json({ configured: true, name: groupName, ...groupRollup(stores) });
}
