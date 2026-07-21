import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionUser } from "@/lib/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  // Never trust a user_id supplied in the request body (that would let
  // anyone overwrite anyone else's subscription row) — always the verified
  // session's own id.
  const userId = (await getSessionUser(token))?.id ?? null;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Nudges aren't configured yet." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "Malformed subscription." }, { status: 400 });
  }

  const { error } = await admin.from("lite_push_subscriptions").upsert({
    user_id: userId,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth_key: body.keys.auth,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
