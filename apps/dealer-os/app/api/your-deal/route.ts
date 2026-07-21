import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { mergeStoreSettings, samePerson } from "@/lib/data";
import { calculateDesk, personLabel } from "@/lib/desk";
import { customerStatusLine, docsToBring, makeShareToken, nextSteps, parseShareToken, type YourDealPayload } from "@/lib/yourDeal";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { rateLimit, clientKey } from "@/lib/rateLimit";

// The public "Your Deal" payload. NO AUTH — the token IS the credential
// (orgId prefix routes the lookup, 32-hex secret gates it), so this route is
// deliberately paranoid: rate-limited per IP, an allowlist payload only (the
// customer's OWN first name, car, payment — never gross, cost, or anyone
// else), and a cleared token kills the link instantly.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rl = await rateLimit(clientKey(request), { limit: 30, windowSec: 60 });
  if (!rl.ok) return NextResponse.json({ error: "Slow down." }, { status: 429 });

  const parsed = parseShareToken(request.nextUrl.searchParams.get("token") || "");
  if (!parsed) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Unavailable." }, { status: 503 });

  const [{ data: leadsRow }, { data: settingsRow }] = await Promise.all([
    supabase.from("app_store").select("value").eq("org_id", parsed.orgId).eq("key", "crmLeads").maybeSingle(),
    supabase.from("app_store").select("value").eq("org_id", parsed.orgId).eq("key", "storeSettings").maybeSingle(),
  ]);
  const leads: any[] = Array.isArray(leadsRow?.value) ? leadsRow!.value : [];
  const lead = leads.find((l) => l?.shareToken === `${parsed.orgId}.${parsed.secret}`);
  if (!lead) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });

  const settings = mergeStoreSettings(settingsRow?.value ?? null);
  const desk = (() => {
    try {
      return calculateDesk(lead);
    } catch {
      return null;
    }
  })();
  const hasNumbers = !!desk && lead.sellingPrice > 0 && lead.term > 0;

  const payload: YourDealPayload = {
    storeName: settings.storeName,
    customerFirstName: String(lead.customerFirstName || String(lead.customer || "").split(/\s+/)[0] || ""),
    vehicle: String(lead.vehicle || "Your next vehicle"),
    stockNumber: String(lead.stockNumber || ""),
    vehicleClass: String(lead.vehicleClass || ""),
    status: customerStatusLine(lead.status),
    payment: hasNumbers ? Math.round(desk!.payment) : null,
    term: hasNumbers ? Number(lead.term) : null,
    cashDown: hasNumbers ? Number(lead.cashDown) || 0 : null,
    salesperson: personLabel(String(lead.salesperson || "")),
    appointment: lead.appointment || undefined,
    docsToBring: docsToBring(lead),
    nextSteps: nextSteps(lead),
  };
  return NextResponse.json(payload);
}

// Mint (or revoke) a customer link — AUTHED. The server owns the token so the
// orgId prefix is always the caller's real org, and reps can only share their
// OWN customers (same privacy rule as every lead surface).
export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Secure backend unavailable." }, { status: 503 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await supabase
    .from("user_profiles").select("org_id, role, employee_name, display_name").eq("id", userData.user.id).maybeSingle();
  if (!profile?.org_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = String(profile.org_id);
  const role = isOwnerEmail(userData.user.email) ? "Admin" : normalizeAccessRole(profile.role);
  const senderName = String(profile.employee_name || profile.display_name || "");

  const body = await request.json().catch(() => null);
  const leadId = String(body?.leadId || "");
  const revoke = body?.revoke === true;
  if (!leadId) return NextResponse.json({ error: "Missing leadId." }, { status: 400 });

  const { data: row } = await supabase
    .from("app_store").select("value, updated_at").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
  const leads: any[] = Array.isArray(row?.value) ? row!.value : [];
  const lead = leads.find((l) => String(l?.id) === leadId);
  if (!lead) return NextResponse.json({ error: "That lead isn't on the board." }, { status: 404 });
  if ((role === "Sales" || role === "BDC") && !samePerson(String(lead.salesperson || ""), senderName)) {
    return NextResponse.json({ error: "You can only share your own customers' deals." }, { status: 403 });
  }

  const shareToken = revoke ? "" : lead.shareToken || makeShareToken(orgId);
  const next = leads.map((l) => (String(l?.id) === leadId ? { ...l, shareToken: shareToken || undefined } : l));
  // Conditional on the write-stamp (same contract as sms): a race means adopt
  // the fresh copy and re-apply — a token write must never clobber the board.
  const query = supabase.from("app_store").update({ value: next, updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("key", "crmLeads");
  const { data: updated } = await (row?.updated_at ? query.eq("updated_at", row.updated_at) : query).select("updated_at");
  if (!updated || !updated.length) {
    const { data: fresh } = await supabase
      .from("app_store").select("value").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
    const freshLeads: any[] = Array.isArray(fresh?.value) ? fresh!.value : [];
    const merged = freshLeads.map((l) => (String(l?.id) === leadId ? { ...l, shareToken: shareToken || undefined } : l));
    await supabase.from("app_store").update({ value: merged, updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("key", "crmLeads");
  }

  // Deliver the secret in the URL FRAGMENT, not the path — it never reaches the
  // Referer header, browser history sync, or server/proxy logs (SOC 2 M-9).
  return NextResponse.json({ ok: true, token: shareToken || null, path: shareToken ? `/deal-view#${shareToken}` : null });
}
