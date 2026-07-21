// Security headers added July 5, 2026 (audit finding) — this app takes real
// payments and had zero platform-level hardening: no clickjacking protection,
// no CSP, no HSTS. Scoped to what the app actually talks to: same-origin API
// routes + a direct browser connection to Supabase for auth/data sync. No
// Stripe.js runs client-side (checkout is a server-created hosted-page
// redirect), so Stripe isn't in connect-src.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

// Next.js dev mode wraps modules in eval() for its Fast Refresh / HMR runtime
// (production builds don't) — without 'unsafe-eval' here, the CSP silently
// blocks that eval and the app never hydrates past the splash screen, with no
// console error surfaced. Scoped to dev only so the deployed app stays strict.
const isDev = process.env.NODE_ENV !== "production";

// Plaid Link (VIP bank connection, July 13): the widget script loads from
// cdn.plaid.com, renders in an iframe from that same origin, and talks to
// production.plaid.com — three scoped exceptions, nothing else loosened.
// Without them this CSP silently blocks the script and the Connect button
// sits grey forever (no error surfaces on the phone).
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' https://cdn.plaid.com${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src 'self' https://production.plaid.com${supabaseUrl ? ` ${supabaseUrl}` : ""}`,
  `frame-src 'self' https://cdn.plaid.com`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
