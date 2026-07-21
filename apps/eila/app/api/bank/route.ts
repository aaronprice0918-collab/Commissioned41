import { NextResponse } from "next/server";
import { getSessionUser, hasVipSubscription } from "@/lib/entitlement";
import { rateLimited } from "@/lib/rateLimit";
import {
  bankConfigured,
  createBankLinkToken,
  disconnectBank,
  exchangeAndSaveItem,
  listBankItems,
  syncBank,
} from "@/lib/bank";

// The Platinum VIP bank connection, one route, action-dispatched:
//   { action: "status" }                      -> { vip, configured, connected, institutions }
//   { action: "link-token" }                  -> { link_token }
//   { action: "exchange", public_token, institution } -> { ok }
//   { action: "sync" }                        -> { sync: BankSyncResult | null }
//   { action: "disconnect" }                  -> { removed }
// Every action requires a signed-in member; everything past "status" requires
// VIP (fail closed — this feature costs real money per connection).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const user = await getSessionUser(token);
  if (!user?.email) return NextResponse.json({ error: "not-signed-in" }, { status: 401 });

  if (await rateLimited(`bank:${user.id}`, 60_000, 20)) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  try {
    const vip = await hasVipSubscription(user.email);

    if (action === "status") {
      const items = vip && (await bankConfigured()) ? await listBankItems(user.id) : [];
      return NextResponse.json({
        vip,
        configured: await bankConfigured(),
        connected: items.length > 0,
        institutions: items.map((i) => i.institution),
      });
    }

    if (!vip) return NextResponse.json({ error: "vip-required" }, { status: 402 });
    if (!(await bankConfigured())) return NextResponse.json({ error: "bank-not-configured" }, { status: 503 });

    switch (action) {
      case "link-token":
        return NextResponse.json({ link_token: await createBankLinkToken(user.id) });
      case "exchange": {
        if (typeof body.public_token !== "string") {
          return NextResponse.json({ error: "missing public_token" }, { status: 400 });
        }
        const institution = typeof body.institution === "string" ? body.institution : "Bank";
        await exchangeAndSaveItem(user.id, user.email, body.public_token, institution);
        console.log(`[bank] item saved: ${institution} for ${user.email}`);
        return NextResponse.json({ ok: true });
      }
      case "sync":
        return NextResponse.json({ sync: await syncBank(user.id) });
      case "disconnect":
        return NextResponse.json({ removed: await disconnectBank(user.id) });
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    // Plaid errors carry their verdict in response.data (error_code/message) —
    // log THAT, not the axios config dump (July 12: the useful part truncated).
    const detail = (e as { response?: { data?: unknown } })?.response?.data;
    console.error(`[bank] ${action} failed:`, detail ? JSON.stringify(detail) : e);
    return NextResponse.json({ error: "bank-error" }, { status: 500 });
  }
}
