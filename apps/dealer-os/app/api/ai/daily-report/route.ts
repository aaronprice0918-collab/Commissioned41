import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { generateDailyReport } from "@/lib/dailyReport";

// EILA's End-of-Day Brief. GET returns the latest stored brief for the caller's
// store; POST generates a fresh one on demand (managers/admins only). The nightly
// run is handled by /api/cron/daily-report.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function caller(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { supabase: null as any, orgId: null, role: "", email: "" };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { supabase, orgId: null, role: "", email: "" };
  const { data } = await supabase.auth.getUser(token);
  if (!data.user) return { supabase, orgId: null, role: "", email: "" };
  const { data: profile } = await supabase.from("user_profiles").select("org_id, role, email").eq("id", data.user.id).maybeSingle();
  return {
    supabase,
    orgId: (profile?.org_id as string | undefined) || null,
    role: normalizeAccessRole(profile?.role),
    email: profile?.email || data.user.email || "",
  };
}

export async function GET(request: NextRequest) {
  const { supabase, orgId, role, email } = await caller(request);
  if (!supabase) return NextResponse.json({ error: "Store not connected" }, { status: 503 });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The End-of-Day Brief is leadership-only — it names every rep with their
  // units/gross/PVR and flags who's slipping. Same gate the POST generator uses;
  // a line rep must not be able to read the whole floor's leaderboard.
  const canRead = role === "Manager" || role === "Admin" || role === "F&I" || isOwnerEmail(email);
  if (!canRead) return NextResponse.json({ error: "Managers only" }, { status: 403 });
  const { data } = await supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", "dailyReports").maybeSingle();
  const store: any = data?.value && typeof data.value === "object" ? data.value : {};
  return NextResponse.json({ latest: store.latest ?? null });
}

export async function POST(request: NextRequest) {
  const { supabase, orgId, role, email } = await caller(request);
  if (!supabase) return NextResponse.json({ error: "Store not connected" }, { status: 503 });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Only leadership generates the brief.
  const canGenerate = role === "Manager" || role === "Admin" || role === "F&I" || isOwnerEmail(email);
  if (!canGenerate) return NextResponse.json({ error: "Managers only" }, { status: 403 });

  const result = await generateDailyReport(orgId, new Date().toISOString());
  if (!result.ok) return NextResponse.json({ error: result.error || "Generation failed" }, { status: 502 });
  return NextResponse.json({ ok: true, report: result.report });
}
