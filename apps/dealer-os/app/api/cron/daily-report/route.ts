import { NextRequest, NextResponse } from "next/server";
import { generateDailyReport, activeOrgIds } from "@/lib/dailyReport";
import { cronAuthorized } from "@/lib/securityLog";

// Nightly run: Vercel Cron hits this once a night (see vercel.json) and EILA
// generates the End-of-Day Brief for every active store. Secured by CRON_SECRET
// — Vercel sends it as the Authorization bearer on scheduled invocations.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Constant-time bearer check; fail-closed in production if the secret is unset.
  if (!cronAuthorized(request, "cron/daily-report")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowISO = new Date().toISOString();
  const orgs = await activeOrgIds();
  const results: { orgId: string; ok: boolean; error?: string }[] = [];
  for (const orgId of orgs) {
    try {
      const r = await generateDailyReport(orgId, nowISO, true);
      results.push({ orgId, ok: r.ok, error: r.error });
    } catch (e) {
      results.push({ orgId, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return NextResponse.json({ ran: results.length, generated: results.filter((r) => r.ok).length, results });
}
