import { NextResponse } from "next/server";
import { getSessionEmail, hasActiveSubscription, isValidTeamCode } from "@/lib/entitlement";
import { getSupabaseAdmin, ENTITLEMENTS_TABLE } from "@/lib/supabaseAdmin";

// Redeems a team comp code for the signed-in account. Someone who arrived via
// a /team/<code> link signs up as normal; the paywall then posts the stashed
// code here, and if it's in TEAM_CODES we mark their account "comped" in
// lite_entitlements — full access, no card, no trial clock. The email comes
// from the verified Supabase session token (never the request body), so a code
// can only ever comp the account that actually presents it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!isValidTeamCode(code)) {
    return NextResponse.json({ error: "That team code isn't valid." }, { status: 400 });
  }

  // Comping is a table write, so it needs the service-role client. Without it
  // there is nowhere durable to record the grant — say so instead of silently
  // "succeeding" into an app that will still paywall them.
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Team access isn't configured yet." }, { status: 503 });
  }

  try {
    // Already paying / trialing / comped? Don't overwrite a live Stripe status
    // with "comped" — the webhook owns those rows and would fight us on the
    // next billing event. Redeeming is simply a no-op success for them.
    if (await hasActiveSubscription(email)) {
      return NextResponse.json({ ok: true, already: true });
    }

    const { error } = await admin.from(ENTITLEMENTS_TABLE).upsert(
      {
        email,
        status: "comped",
        entitled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" },
    );
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, code: code.toLowerCase() });
  } catch (e) {
    console.error("[team] comp failed:", e);
    return NextResponse.json({ error: "Could not activate team access." }, { status: 500 });
  }
}
