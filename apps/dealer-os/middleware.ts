import { NextResponse, type NextRequest } from "next/server";

// ── Auth safety net (SOC 2 CC6.1 defense-in-depth) ──────────────────────────
// Every API route already implements its own auth check, but middleware is the
// catch-all: if a new route is added without auth, this layer blocks it instead
// of leaving an open door. Routes listed in PUBLIC_ROUTES are exempted because
// they are intentionally unauthenticated (webhooks, public forms, etc.).
//
// This middleware does NOT replace per-route auth — it's a lightweight guard
// that only checks for the PRESENCE of a credential (Bearer token, signature,
// or cron secret). The route itself still validates and authorizes.

// Routes that are intentionally public (no auth required):
// - Stripe/Twilio webhooks: authenticated by signature, not a bearer token
// - Waitlist POST: public form submission
// - Checkout POST: creates a Stripe session (may be pre-auth in signup flow)
// - Your-deal GET: capability-based (token in query string, not header)
// - Signup POST: public self-serve sign-up (gated by SIGNUPS_OPEN flag)
const PUBLIC_ROUTES = new Set([
  "/api/stripe/webhook",
  "/api/sms/webhook",
  "/api/waitlist",
  "/api/checkout",
  "/api/your-deal",
  "/api/signup",
]);

// Cron routes are authenticated by CRON_SECRET bearer token — they ARE
// authenticated, just differently. The middleware allows them through to let
// the route's cronAuthorized() handle the constant-time check.
const CRON_PREFIX = "/api/cron/";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only gate API routes — pages are rendered by the client app with its own
  // auth context (Supabase onAuthStateChange).
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Public routes bypass the credential check.
  if (PUBLIC_ROUTES.has(pathname)) return NextResponse.next();

  // Cron routes use their own CRON_SECRET check (cronAuthorized).
  if (pathname.startsWith(CRON_PREFIX)) return NextResponse.next();

  // Every other API route MUST have a credential. Check for the presence of
  // an Authorization header — not its validity (the route does that). This
  // catches routes that forgot their own auth check.
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
  // Only run on API routes — skip static assets, images, Next.js internals.
  matcher: "/api/:path*",
};
