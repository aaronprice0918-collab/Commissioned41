import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { isOwnerEmail } from "@/lib/access";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
import { guardedMutate } from "@/lib/storeServer";

// Self-hosted runtime-health sensor (no third-party service / no new cost).
// Client error boundaries + the global TelemetryReporter POST runtime errors
// here; they're kept in a small capped ring in app_store so EILA can report the
// app's ACTUAL health (errors/crashes) to Aaron, not just the business/data
// picture. Lightweight by design — not full APM (no latency/uptime tracing).
//
// SECURITY: this feed is injected verbatim into the owner-only HQ AI prompt, so
// it must NOT be an open write. It requires an authenticated caller and stores
// under the CALLER'S org — an anonymous internet POST can no longer plant text
// into the owner's AI context or flush the error ring (a monitoring DoS).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAP = 150; // bounded storage — the log can't grow unbounded or be spammed big

export type TelemetryEvent = { ts: string; kind: string; message: string; path: string };

export async function POST(req: Request) {
  // Silently drop floods (204) — telemetry must never surface an error to the client.
  const rl = await rateLimit(clientKey(req), { limit: 60, windowSec: 60 });
  if (!rl.ok) return new NextResponse(null, { status: 204 });

  const supabase = getSupabaseServerClient();
  if (!supabase) return new NextResponse(null, { status: 204 });

  // Require a valid session and resolve the caller's org. No token / no profile
  // org (owner excepted) → silently drop, so the endpoint can't be written
  // anonymously. Telemetry stays fire-and-forget: never an error to the client.
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return new NextResponse(null, { status: 204 });
  const { data: auth, error: authErr } = await supabase.auth.getUser(token);
  if (!auth?.user || authErr) return new NextResponse(null, { status: 204 });
  const { data: profile } = await supabase
    .from("user_profiles").select("org_id").eq("id", auth.user.id).maybeSingle();
  const orgId = (profile?.org_id as string | undefined) || (isOwnerEmail(auth.user.email) ? DEFAULT_ORG_ID : null);
  if (!orgId) return new NextResponse(null, { status: 204 });

  const body = (await req.json().catch(() => ({}))) as { message?: string; kind?: string; path?: string };
  const message = String(body.message || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!message) return new NextResponse(null, { status: 204 });

  const event: TelemetryEvent = {
    ts: new Date().toISOString(),
    kind: String(body.kind || "error").slice(0, 40),
    message,
    path: String(body.path || "").slice(0, 120),
  };

  try {
    await guardedMutate<TelemetryEvent[]>(supabase, orgId, "telemetry", (current) => {
      const list = Array.isArray(current) ? current : [];
      return [event, ...list].slice(0, CAP);
    });
  } catch {
    // Never let telemetry capture throw into the caller.
  }
  return new NextResponse(null, { status: 204 });
}
