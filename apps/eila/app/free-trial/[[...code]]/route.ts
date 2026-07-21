import { NextResponse } from "next/server";
import { firstTrialCode } from "@/lib/entitlement";

// The shareable free-trial link: lite.commissioned41.com/free-trial
//
// A clean, professional URL to hand out — no query string, no code to type.
// It redirects into the app with a trial invite attached, so the visitor lands
// in the normal sign-up flow and the paywall opens as the 30-day free trial
// (checkout still validates the code server-side, so this grants nothing on
// its own).
//
// /free-trial            -> uses the first trial code (TRIAL_CODES env, or the
//                           built-in default when the env isn't set)
// /free-trial/<code>     -> uses <code> (pretty per-partner/per-campaign links)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code?: string[] }> },
) {
  const url = new URL("/", req.url);
  const code = (await params).code?.[0]?.trim() || firstTrialCode();
  if (code) url.searchParams.set("invite", code);
  return NextResponse.redirect(url);
}
