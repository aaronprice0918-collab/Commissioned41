import { timingSafeEqual } from "node:crypto";

// ── Security-event logging + constant-time secret compare ────────────────────
// SOC 2 CC7.2 (monitoring) + CC6.1. Until an APM/SIEM (Sentry/Datadog) is wired,
// these emit a single structured line to the platform log (Vercel) so failed
// auth, entitlement denials, and signature failures are at least searchable and
// alertable — instead of the previous silent 401/402 paths. Swap the sink for a
// real transport later without touching call sites.

export type SecurityEvent =
  | "auth_failed"
  | "entitlement_denied"
  | "webhook_signature_failed"
  | "cron_auth_failed"
  | "role_denied"
  | "rate_limited"
  | "customer_erased";

/** Emit a structured security event. Never include secrets or full PII — ids and
 *  coarse reasons only, so the log itself isn't a new exposure. */
export function logSecurityEvent(
  event: SecurityEvent,
  detail: { route?: string; orgId?: string; userId?: string; reason?: string } = {},
): void {
  // eslint-disable-next-line no-console
  console.warn(`[security] ${JSON.stringify({ event, ...detail, at: new Date().toISOString() })}`);
}

/** Constant-time string compare — no early-out timing side channel on secrets. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Shared Vercel-Cron bearer check: constant-time, fail-CLOSED in production.
 *  Returns true when authorized. Logs a security event on failure. */
export function cronAuthorized(req: Request, routeName: string): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (!secret) {
    // No secret configured: allow only outside production (local testing).
    if (process.env.NODE_ENV === "production") {
      logSecurityEvent("cron_auth_failed", { route: routeName, reason: "secret_unset" });
      return false;
    }
    return true;
  }
  const ok = safeEqual(auth, `Bearer ${secret}`);
  if (!ok) logSecurityEvent("cron_auth_failed", { route: routeName, reason: "bad_bearer" });
  return ok;
}
