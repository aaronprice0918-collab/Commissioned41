import { NextResponse } from "next/server";
import { PLAID_COUNTRY_CODES, PLAID_PRODUCTS, plaid, plaidConfigured } from "@/lib/plaid";
import { isSameOrigin, safeDetail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "bad origin" }, { status: 403 });
  }
  if (!plaidConfigured()) {
    return NextResponse.json({ error: "Plaid keys not configured in .env.local" }, { status: 400 });
  }
  try {
    // OAuth banks (Chase, BofA, most credit unions) bounce the user to the
    // bank's site and back; redirect_uri must exactly match an Allowed
    // Redirect URI registered in the Plaid dashboard.
    const redirectUri = process.env.PLAID_REDIRECT_URI;
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: "aaron" },
      client_name: "MissionOS Finance",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });
    return NextResponse.json({ link_token: res.data.link_token });
  } catch (e: unknown) {
    const detail = (e as { response?: { data?: unknown } })?.response?.data ?? String(e);
    console.error("create-link-token failed:", detail);
    return NextResponse.json({ error: "link_token_failed", detail: safeDetail(detail) }, { status: 500 });
  }
}
