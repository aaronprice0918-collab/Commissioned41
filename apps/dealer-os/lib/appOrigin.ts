// Resolve the app origin for building redirect URLs (Stripe success/cancel,
// billing-portal return). SOC 2 CC6.1 — never build a redirect target from a
// raw, attacker-controllable `Origin` header. Prefer the configured app URL;
// otherwise accept the header ONLY if it's a known host (prod domains, local
// dev, Vercel previews); otherwise fall back to the request's own origin.
const ALLOWED_ORIGINS = new Set([
  "https://missionos.commissioned41.com",
  "https://commissioned41.com",
  "https://www.commissioned41.com",
  "https://hq.commissioned41.com",
]);

export function resolveAppOrigin(req: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");

  const origin = req.headers.get("origin");
  if (origin) {
    const isLocal = /^https?:\/\/localhost(:\d+)?$/.test(origin);
    const isPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
    if (ALLOWED_ORIGINS.has(origin) || isLocal || isPreview) return origin;
  }
  // Unknown/absent Origin → same-origin from the request URL, never the raw header.
  try {
    return new URL(req.url).origin;
  } catch {
    return "https://missionos.commissioned41.com";
  }
}
