import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/securityLog";
import { previewErase, eraseCustomer, type EraseTarget } from "@/lib/customerErase";

// Customer right-to-delete (SOC 2 P5.2/P6, CCPA/GDPR erasure). Admin/owner only,
// scoped to the caller's org. Two-step: POST WITHOUT confirm returns a PREVIEW of
// exactly what would be purged; POST with confirm:true performs the deletion.
// Id-based only (leadId and/or dealId) — never name matching. Every erase is
// logged as a security event for the audit trail.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { supabase: null, ok: false, orgId: "", email: "", userId: "" };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { supabase, ok: false, orgId: "", email: "", userId: "" };
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return { supabase, ok: false, orgId: "", email: "", userId: "" };
  const owner = isOwnerEmail(data.user.email);
  const { data: profile } = await supabase
    .from("user_profiles").select("role, org_id").eq("id", data.user.id).maybeSingle();
  const role = owner ? "Admin" : normalizeAccessRole(profile?.role);
  return {
    supabase,
    ok: (owner || role === "Admin") && !!profile?.org_id,
    orgId: String(profile?.org_id || ""),
    email: data.user.email || "",
    userId: data.user.id,
  };
}

export async function POST(request: NextRequest) {
  const { supabase, ok, orgId, email, userId } = await requireAdmin(request);
  if (!supabase) return NextResponse.json({ error: "Secure backend unavailable." }, { status: 503 });
  if (!ok || !orgId) {
    logSecurityEvent("role_denied", { route: "customer-erase", userId: email });
    return NextResponse.json({ error: "Deleting customer data is an admin-only action." }, { status: 403 });
  }

  const rl = await rateLimit(clientKey(request, userId), { limit: 20, windowSec: 60 });
  if (!rl.ok) return tooManyRequests(rl);

  const body = (await request.json().catch(() => ({}))) as { leadId?: string; dealId?: string; confirm?: boolean };
  const target: EraseTarget = { leadId: body.leadId, dealId: body.dealId };
  if (!target.leadId && !target.dealId) {
    return NextResponse.json({ error: "Provide a leadId and/or dealId to erase." }, { status: 400 });
  }

  try {
    if (body.confirm !== true) {
      const preview = await previewErase(supabase, orgId, target);
      return NextResponse.json({ preview, confirmRequired: true });
    }
    const result = await eraseCustomer(supabase, orgId, target);
    logSecurityEvent("customer_erased", { route: "customer-erase", orgId, userId: email, reason: `lead=${target.leadId || "-"} deal=${target.dealId || "-"}` });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[customer-erase]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Erase failed — nothing may have been partially removed; try again." }, { status: 500 });
  }
}
