import { NextResponse } from "next/server";
import { isOwnerEmail } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { DEFAULT_ORG_ID } from "@/lib/orgs";

// Public waitlist capture for the marketing site. POST is open (anonymous
// visitors sign up); GET is owner-only so Aaron can see who joined. Signups are
// stored in app_store under the "waitlist" key via the service-role client.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "waitlist";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  try {
    const rl = await rateLimit(clientKey(req), { limit: 5, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim().slice(0, 120);
    const source = String(body.source || "landing").trim().slice(0, 60);
    if (!EMAIL_RE.test(email) || email.length > 200) {
      return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      // Dev convenience: accept without persisting when no DB is configured.
      return NextResponse.json({ ok: true });
    }

    const { data } = await supabase.from("app_store").select("value").eq("org_id", DEFAULT_ORG_ID).eq("key", KEY).maybeSingle();
    const list: any[] = Array.isArray(data?.value) ? data.value : [];
    if (!list.some((e) => String(e.email).toLowerCase() === email)) {
      list.push({ id: `WL-${Date.now()}`, email, name, source, createdAt: new Date().toISOString() });
      await supabase.from("app_store").upsert({ org_id: DEFAULT_ORG_ID, key: KEY, value: list, updated_at: new Date().toISOString() }, { onConflict: "org_id,key" });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not join the waitlist. Try again." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth.user || !isOwnerEmail(auth.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { data } = await supabase.from("app_store").select("value").eq("org_id", DEFAULT_ORG_ID).eq("key", KEY).maybeSingle();
  return NextResponse.json({ waitlist: Array.isArray(data?.value) ? data.value : [] });
}
