import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { buildFixedOpsDigest } from "@/lib/fixedOpsDigest";
import { mergeStoreSettings } from "@/lib/data";
import { sendSms, twilioCredsPresent } from "@/lib/twilio";
import { cronAuthorized } from "@/lib/securityLog";

// Fixed Ops Weekly Digest — Monday morning, every org with a service lane or
// parts counter gets its week built (lib/fixedOpsDigest.ts, the same brain
// EILA reads). Delivery: SMS to the org's commsConfig.digestTo when Twilio
// creds AND that number exist — otherwise the digest is built and reported
// here but not sent (byte-identical inert, the Stripe/Twilio house pattern).
// commsConfig is the server-only row (never in allowedKeys); Aaron seeds
// digestTo per org by SQL, same as fromNumber.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  // Constant-time bearer check; fail-CLOSED in production if the secret is unset.
  if (!cronAuthorized(req, "cron/fixed-ops-digest")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseServerClient();
  if (!admin) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  const { data: rows, error } = await admin
    .from("app_store")
    .select("org_id,key,value")
    .in("key", ["serviceLane", "partsCounter", "storeSettings", "commsConfig"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byOrg = new Map<string, Record<string, unknown>>();
  for (const row of rows ?? []) {
    const org = byOrg.get(row.org_id) ?? {};
    org[row.key] = row.value;
    byOrg.set(row.org_id, org);
  }

  const results: { org: string; sent: boolean; reason?: string }[] = [];
  for (const [orgId, org] of byOrg) {
    const visits = Array.isArray(org.serviceLane) ? (org.serviceLane as any[]) : [];
    const hasParts = org.partsCounter != null;
    // No fixed-ops data at all → nothing to digest for this org.
    if (!visits.length && !hasParts) continue;

    const settings = mergeStoreSettings((org.storeSettings as any) ?? null);
    const digest = buildFixedOpsDigest(visits as any, org.partsCounter, settings.storeName, new Date());

    const comms = (org.commsConfig ?? {}) as { fromNumber?: string; digestTo?: string };
    const to = typeof comms.digestTo === "string" ? comms.digestTo.trim() : "";
    if (!to || !twilioCredsPresent()) {
      results.push({ org: orgId, sent: false, reason: !to ? "no digestTo configured" : "twilio not configured" });
      continue;
    }
    const sent = await sendSms(to, digest.text, comms.fromNumber || undefined);
    results.push({ org: orgId, sent: sent.ok, reason: sent.ok ? undefined : sent.error });
  }

  return NextResponse.json({ ok: true, orgs: results.length, results });
}
