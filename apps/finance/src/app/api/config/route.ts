import { NextResponse } from "next/server";
import { getConfig, saveConfig, type AppConfig } from "@/lib/config";
import { isSameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getConfig());
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "bad origin" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<AppConfig>;
  const saved = await saveConfig(body);
  return NextResponse.json(saved);
}
