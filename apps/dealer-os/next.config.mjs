/** @type {import('next').NextConfig} */

// Security headers applied to every response (SOC 2 CC6.6/CC6.7 — boundary
// protection / defense-in-depth). The app renders customer PII behind auth, so
// clickjacking + sniffing defenses matter. CSP is intentionally conservative:
// Next needs 'unsafe-inline' for its inline runtime/styles; script stays
// self-only (no third-party script hosts are used). Tighten with nonces later.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(self)" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // EILA's voice plays from a blob: URL (/api/ai/voice → blob); camera capture
      // previews as data:. Without this, media falls back to default-src and breaks.
      "media-src 'self' blob: data:",
      "worker-src 'self' blob:",
      // Client talks only to same-origin API routes and Supabase (REST + auth +
      // storage + realtime). The AI brain / ElevenLabs / Twilio are server-side.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The customer "Your Deal" pages carry a capability secret — send NO referrer
      // at all so the token can't leak to any sub-resource or outbound link.
      { source: "/deal-view/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/deal-view", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
