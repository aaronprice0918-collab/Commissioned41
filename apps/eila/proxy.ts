import { NextResponse, type NextRequest } from "next/server";

// ── Auth safety net (defense-in-depth) ──────────────────────────────────────
// Every API route implements its own auth, but this catches any future route
// added without one. See apps/dealer-os/proxy.ts for the full rationale. Only
// checks for the PRESENCE of a credential — the route still validates it.

const PUBLIC_ROUTES = new Set([
  "/api/stripe/webhook",
  "/api/checkout",
  "/api/team",           // Team comp code redemption (public link)
  "/api/entitlement",    // Checked by the client shell (sends its own token when available)
  "/api/referral/code",  // Public referral code validation
]);

const CRON_PREFIX = "/api/cron/";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (PUBLIC_ROUTES.has(pathname)) return NextResponse.next();
  if (pathname.startsWith(CRON_PREFIX)) return NextResponse.next();

  const auth = request.headers.get("authorization");
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
