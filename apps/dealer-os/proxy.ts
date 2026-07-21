import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Domain structure: commissioned41.com is the PRIME (marketing) domain; the app
// lives on the missionos.* subdomain. The apex serves only the marketing page,
// its assets, public APIs, and public share links — every other (app) route on
// the apex is redirected to the app subdomain so the two never blur. The app
// subdomain and all other hosts pass through untouched.
const MARKETING_HOSTS = new Set(["commissioned41.com", "www.commissioned41.com"]);
const APP_HOST = "missionos.commissioned41.com";
const HQ_HOST = "hq.commissioned41.com"; // Commissioned 41 owner/company core portal

function apexServesDirectly(pathname: string) {
  return (
    pathname === "/welcome" ||
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname === "/signup" ||
    pathname.startsWith("/api/") ||      // public waitlist POST is called from the landing page
    pathname.startsWith("/card/") ||     // public, shareable business-card links
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/_next/") ||
    /\.[a-zA-Z0-9]+$/.test(pathname)     // static files (.html, .png, .ico, .webmanifest, ...)
  );
}

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const { pathname } = req.nextUrl;

  // Commissioned 41 core portal: landing on hq.* sends the owner to the company
  // command center (Commissioned 41 HQ). Same account/login as the product app;
  // all other routes pass through so the owner can navigate the app normally.
  if (host === HQ_HOST) {
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/waitlist";
      return NextResponse.redirect(url, 307);
    }
    return NextResponse.next();
  }

  if (!MARKETING_HOSTS.has(host)) return NextResponse.next();

  // Apex root → marketing landing. REDIRECT (not rewrite) so the URL becomes
  // /welcome and the page renders truly public + shell-free. A rewrite kept the
  // URL at "/", which made the app wrap the marketing page in the dashboard shell
  // and render the owner-only Jimmy assistant on a public page.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    return NextResponse.redirect(url, 307);
  }

  // Marketing-domain content stays on the apex.
  if (apexServesDirectly(pathname)) return NextResponse.next();

  // Any app route requested on the apex → send it to the app subdomain.
  const url = req.nextUrl.clone();
  url.host = APP_HOST;
  url.protocol = "https";
  url.port = "";
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
