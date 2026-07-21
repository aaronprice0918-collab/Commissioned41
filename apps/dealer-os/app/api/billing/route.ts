import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { getStripeServerClient } from "@/lib/stripe";
import { orgEntitled, stripeConfigured } from "@/lib/billing";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { resolveAppOrigin } from "@/lib/appOrigin";

// The caller's org billing status (GET) and the Stripe billing portal (POST).
// GET powers the AppShell paywall and the /billing page: entitled or not, the
// human-readable reason, and enough state to render subscribe vs manage.
// POST opens the Stripe Customer Portal for the org's customer — card update,
// invoices, cancel — owner/admin only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function callerOrg(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { supabase: null, orgId: null as string | null, role: "", email: "" };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { supabase, orgId: null, role: "", email: "" };
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return { supabase, orgId: null, role: "", email: "" };
  const { data: profile } = await supabase
    .from("user_profiles").select("org_id, role").eq("id", data.user.id).maybeSingle();
  return {
    supabase,
    orgId: (profile?.org_id as string | undefined) || null,
    role: String(profile?.role || ""),
    email: data.user.email || "",
  };
}

export async function GET(request: NextRequest) {
  const { supabase, orgId } = await callerOrg(request);
  // No secure backend (dev) — billing is off, everything is open.
  if (!supabase) return NextResponse.json({ configured: false, entitled: true, reason: "dev" });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await orgEntitled(supabase, orgId);
  return NextResponse.json({
    configured: stripeConfigured(),
    entitled: result.entitled,
    reason: result.reason,
    status: result.billing?.status ?? null,
    currentPeriodEnd: result.billing?.currentPeriodEnd ?? null,
    hasCustomer: !!result.billing?.stripeCustomerId,
    foundingStore: orgId === DEFAULT_ORG_ID,
    orgId,
  });
}

export async function POST(request: NextRequest) {
  const stripe = getStripeServerClient();
  if (!stripe) return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });
  const { supabase, orgId, role, email } = await callerOrg(request);
  if (!supabase || !orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const normalizedRole = role.toLowerCase();
  if (!(normalizedRole === "admin" || normalizedRole === "owner")) {
    return NextResponse.json({ error: "Billing is managed by the store admin." }, { status: 403 });
  }

  const rl = await rateLimit(clientKey(request, orgId), { limit: 20, windowSec: 60 });
  if (!rl.ok) return tooManyRequests(rl);

  const origin = resolveAppOrigin(request);
  try {
    const { billing } = await orgEntitled(supabase, orgId);
    let customerId = billing?.stripeCustomerId;
    if (!customerId && email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      customerId = customers.data[0]?.id;
    }
    if (!customerId) return NextResponse.json({ error: "No subscription on file for this store yet." }, { status: 400 });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[billing/portal]", e);
    return NextResponse.json({ error: "Could not open the billing portal." }, { status: 400 });
  }
}
