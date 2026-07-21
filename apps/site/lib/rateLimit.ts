// Tiny in-memory, per-IP rate limiter. Module-level state, so it resets on
// cold start and is scoped to a single serverless instance — good enough as a
// first line of defense against email-bombing / payload spam on these routes.

const hits = new Map<string, number[]>();

/**
 * Records a request for `ip` and reports whether it is allowed.
 * Returns false once more than `max` requests have arrived within `windowMs`.
 */
export function rateLimit(ip: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length <= max;
}

/** Best-effort client IP from the x-forwarded-for chain (first hop). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || "unknown";
}
