import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getSessionEmail } from "@/lib/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Readable alphabet — no 0/O or 1/I/L, so a code read aloud or texted never
// gets misheard/mistyped.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function randomCode(len = 7): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// Get-or-create the caller's own referral code. Idempotent — calling it
// twice returns the same code, never generates a second one per person.
export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Referrals aren't configured yet." }, { status: 503 });

  const { data: existing } = await admin
    .from("lite_referrals")
    .select("code")
    .eq("referrer_email", email)
    .maybeSingle();
  if (existing?.code) return NextResponse.json({ code: existing.code });

  // Collision odds are astronomically low at this alphabet/length, but retry
  // a few times against the primary key rather than trust it blindly.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { error } = await admin.from("lite_referrals").insert({ code, referrer_email: email });
    if (!error) return NextResponse.json({ code });
    if (!String(error.message).toLowerCase().includes("duplicate")) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Couldn't generate a code — try again." }, { status: 500 });
}
