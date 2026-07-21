import { NextResponse } from "next/server";

// The shareable team-access link: lite.commissioned41.com/team/<code>
//
// Hand one clean URL to a whole team (a partner dealership's sales floor) and
// everyone who signs up through it gets EILA free — no card, no trial clock.
// This just stashes the code client-side via the ?team= param; the actual
// grant happens in /api/team, which validates the code against TEAM_CODES
// server-side, so the link itself grants nothing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const url = new URL("/", req.url);
  const code = (await params).code?.trim();
  if (code) url.searchParams.set("team", code);
  return NextResponse.redirect(url);
}
