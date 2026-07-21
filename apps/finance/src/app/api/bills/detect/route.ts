import { NextResponse } from "next/server";
import { loadProfile } from "@/lib/profile";
import { detectRecurringBills } from "@/lib/recurring";
import { isSameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recurring charges found in the synced transactions that aren't bills yet. */
export async function GET(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "bad origin" }, { status: 403 });
  }
  const { profile, isLive } = await loadProfile();
  if (!isLive) {
    return NextResponse.json({ candidates: [], isLive: false });
  }
  const candidates = detectRecurringBills(profile.transactions, profile.bills);
  return NextResponse.json({ candidates, isLive: true });
}
