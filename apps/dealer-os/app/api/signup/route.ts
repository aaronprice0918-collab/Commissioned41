import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { provisionOrg } from "@/lib/provision";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";

// Public self-serve sign-up: a dealership creates its own org + admin login.
// (Billing/paywall via Stripe is the next layer; for now it starts a free trial.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Self-serve sign-up stays CLOSED until Stripe billing is wired (demo-only).
// Flip NEXT_PUBLIC_SIGNUPS_OPEN="true" in Vercel to open it (the wizard reads the
// same flag and redirects to the demo form while it's closed).
const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "true";

export async function POST(req: Request) {
  if (!SIGNUPS_OPEN) {
    return NextResponse.json(
      { error: "Self-serve sign-up isn't open yet — request a demo and we'll get you set up." },
      { status: 403 },
    );
  }
  // Tight per-IP cap — org/account creation is expensive and abuse-prone.
  const rl = await rateLimit(clientKey(req), { limit: 5, windowSec: 60 });
  if (!rl.ok) return tooManyRequests(rl);

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Sign-up isn't available right now." }, { status: 503 });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const result = await provisionOrg(supabase, {
      orgName: body.dealershipName,
      adminEmail: body.email,
      adminPassword: body.password,
      adminName: body.name,
    });
    // orgId rides back so the wizard can hand straight off to Stripe Checkout
    // with the new store attached (the webhook activates it by this id).
    return NextResponse.json({ ok: true, orgId: result.orgId, orgName: result.orgName, email: result.adminEmail });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sign-up failed." }, { status: 400 });
  }
}
