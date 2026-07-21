import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, gateActive, verifySessionToken } from "@/lib/session";

// Next 16 renamed the "middleware" convention to "proxy". This runs before every
// matched request and enforces the app lock.

const PUBLIC_PATHS = ["/login"];
const PUBLIC_APIS = ["/api/auth/login", "/api/auth/logout"];
// Always public (no login required) — legal pages Plaid / anyone can view.
const OPEN_PATHS = ["/privacy", "/terms"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (PUBLIC_APIS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!gateActive()) return NextResponse.next();

  const authed = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  // Already-authed users shouldn't sit on the login page.
  if (PUBLIC_PATHS.includes(pathname)) {
    if (authed) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (authed) return NextResponse.next();

  // Unauthenticated: APIs get 401, pages redirect to login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
