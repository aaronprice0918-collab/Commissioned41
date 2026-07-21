import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { twilioCredsPresent, twilioFromNumber } from "@/lib/twilio";
import { isAdmin } from "@/lib/access";

// Texting go-live status — the admin's one-look answer to "is texting on
// yet?". Booleans and masked tails only: this route NEVER returns a secret,
// and commsConfig itself stays server-only (not in the store route's
// allowedKeys). Powers the Texting card on Store Settings.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maskPhone = (value: string) => (value ? `···${value.replace(/[^0-9]/g, "").slice(-4)}` : null);

export async function GET(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  // Dev file-store path — nothing configured, render the checklist state.
  if (!supabase) return NextResponse.json({ configured: false, credsPresent: false, fromNumber: null, digestTo: null, dev: true });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await supabase
    .from("user_profiles").select("org_id, role, email").eq("id", data.user.id).maybeSingle();
  const orgId = (profile?.org_id as string | undefined) || null;
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin({ email: String(profile?.email || data.user.email || ""), role: String(profile?.role || ""), employeeName: "", orgId })) {
    return NextResponse.json({ error: "Texting setup is managed by the store admin." }, { status: 403 });
  }

  const { data: comms } = await supabase
    .from("app_store").select("value").eq("org_id", orgId).eq("key", "commsConfig").maybeSingle();
  const cfg = (comms?.value ?? {}) as { fromNumber?: string; digestTo?: string };
  const orgFrom = typeof cfg.fromNumber === "string" ? cfg.fromNumber : "";
  const envFrom = twilioFromNumber();

  return NextResponse.json({
    configured: twilioCredsPresent() && !!(orgFrom || envFrom),
    credsPresent: twilioCredsPresent(),
    fromNumber: maskPhone(orgFrom || envFrom),
    fromSource: orgFrom ? "store" : envFrom ? "env" : null,
    digestTo: maskPhone(typeof cfg.digestTo === "string" ? cfg.digestTo : ""),
  });
}
