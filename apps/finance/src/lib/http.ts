// Defense-in-depth CSRF check for state-changing routes. SameSite=Lax already
// blocks cross-site cookie sends on POST; this rejects requests whose Origin
// doesn't match the host as a second layer.
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser / same-origin fetches may omit it
  const host = req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Plaid error details are useful in dev but shouldn't leak to clients in prod. */
export function safeDetail(detail: unknown): unknown {
  return process.env.NODE_ENV === "production" ? undefined : detail;
}
