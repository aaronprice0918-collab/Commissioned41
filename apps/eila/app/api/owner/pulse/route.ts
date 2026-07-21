import { NextResponse } from "next/server";
import { getSessionEmail, isOwner } from "@/lib/entitlement";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeOwnerPulse } from "@/lib/owner-pulse";

// The Owner Pulse — every signup, how they got in, and who's active. This
// exposes ALL users' emails and activity, so it is triple-locked: a valid
// session token, that session's email must be the OWNER, and the actual data
// only ever loads through the service-role client on the server. A normal
// paying customer hitting this gets 403, not data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!isOwner(email)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Owner view isn't configured." }, { status: 503 });

  try {
    return NextResponse.json(await computeOwnerPulse(admin));
  } catch (e) {
    console.error("[owner/pulse] failed:", e);
    return NextResponse.json({ error: "Could not load the pulse." }, { status: 500 });
  }
}
