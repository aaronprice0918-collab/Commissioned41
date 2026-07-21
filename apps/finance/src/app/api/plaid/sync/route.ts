import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";
import { isSameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "bad origin" }, { status: 403 });
  }
  try {
    const result = await syncAll();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    console.error("sync failed:", e);
    return NextResponse.json({ error: "sync_failed" }, { status: 500 });
  }
}
