import { NextResponse } from "next/server";
import { isOwnerEmail } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { loadAppPulse } from "@/lib/appPulse";

// Owner-only: the live platform vitals for EILA's Mission Control tiles. Stores
// never see this — gated to the product owner's email.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    // Local dev with no backend wired — allow so the page renders empty.
    if (process.env.NODE_ENV !== "production") return NextResponse.json({ generatedISO: new Date().toISOString(), totals: { stores: 0, activeStores: 0, users: 0, deals: 0, gross: 0, storesNeedingSetup: 0, auditIssues: 0 }, stores: [] });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { data } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
  if (!data?.user || !isOwnerEmail(data.user.email)) {
    return NextResponse.json({ error: "owner only" }, { status: 403 });
  }
  const pulse = await loadAppPulse(supabase, new Date().toISOString());
  return NextResponse.json(pulse);
}
