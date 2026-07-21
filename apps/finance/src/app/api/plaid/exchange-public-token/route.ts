import { NextResponse } from "next/server";
import { plaid } from "@/lib/plaid";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { syncItem } from "@/lib/sync";
import { isSameOrigin, safeDetail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "bad origin" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    public_token?: string;
    institution?: string;
  };
  if (!body.public_token) {
    return NextResponse.json({ error: "missing public_token" }, { status: 400 });
  }

  try {
    const ex = await plaid.itemPublicTokenExchange({ public_token: body.public_token });
    const item = await prisma.plaidItem.upsert({
      where: { itemId: ex.data.item_id },
      create: {
        itemId: ex.data.item_id,
        accessToken: encrypt(ex.data.access_token),
        institution: body.institution ?? "Bank",
      },
      update: {
        accessToken: encrypt(ex.data.access_token),
        institution: body.institution ?? "Bank",
        status: "active",
      },
    });

    // Best-effort initial pull. In sandbox transactions can lag a beat; the
    // periodic /sync route will fill in if this comes back empty.
    let synced = null;
    try {
      synced = await syncItem(item.id);
    } catch (e) {
      console.error("initial sync deferred:", e);
    }

    return NextResponse.json({ ok: true, institution: item.institution, synced });
  } catch (e: unknown) {
    const detail = (e as { response?: { data?: unknown } })?.response?.data ?? String(e);
    console.error("exchange-public-token failed:", detail);
    return NextResponse.json({ error: "exchange_failed", detail: safeDetail(detail) }, { status: 500 });
  }
}
