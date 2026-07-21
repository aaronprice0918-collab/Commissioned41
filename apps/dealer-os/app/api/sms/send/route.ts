import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";

// Outbound texting — the comms hub's send pipe. All the load-bearing rules
// (server-side consent gate, own-customers privacy, opt-out notice, thread
// write) live in lib/smsServer.ts, shared 1:1 with EILA's text_customer tool.
// Inert until Twilio env keys land (GET reports configured for the UI).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: twilioConfigured() });
}

export async function POST(request: NextRequest) {
  if (!twilioConfigured()) {
    return NextResponse.json({ error: "Texting isn't connected yet — add the Twilio keys in Vercel to turn it on." }, { status: 503 });
  }
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Secure backend unavailable." }, { status: 503 });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: profile } = await supabase
    .from("user_profiles").select("org_id, role, employee_name, display_name").eq("id", userData.user.id).maybeSingle();
  if (!profile?.org_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Throttle outbound texts per user — each send costs money and carries TCPA
  // exposure, so a bug or a compromised session can't blast the customer base.
  const rl = await rateLimit(clientKey(request, userData.user.id), { limit: 20, windowSec: 60 });
  if (!rl.ok) return tooManyRequests(rl);

  const payload = await request.json().catch(() => null);
  const result = await sendTextToLead({
    supabase,
    orgId: String(profile.org_id),
    leadId: String(payload?.leadId || ""),
    body: String(payload?.body || ""),
    senderName: String(profile.employee_name || profile.display_name || userData.user.email || ""),
    role: isOwnerEmail(userData.user.email) ? "Admin" : normalizeAccessRole(profile.role),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, message: result.message });
}
