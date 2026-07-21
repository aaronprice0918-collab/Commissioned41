import { getSupabaseAdmin } from "./supabaseAdmin";

// Shared-store rate limiting (July 5 audit finding: the old per-route
// in-memory Map wasn't actually a global limit on Vercel — every serverless
// instance had its own counter, so the "cap" only ever applied per-instance).
// Backed by a small Postgres function (supabase/lite_rate_limits.sql) that
// does an atomic increment-and-return per fixed window. Falls back to the
// old in-memory behavior if that table/function isn't provisioned yet, so
// nothing breaks before Aaron runs the one-time SQL migration.
const fallbackLog = new Map<string, number[]>();

function fallbackRateLimited(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const hits = (fallbackLog.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  fallbackLog.set(key, hits);
  return hits.length > max;
}

export async function rateLimited(key: string, windowMs: number, max: number): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return fallbackRateLimited(key, windowMs, max);

  const bucket = Math.floor(Date.now() / windowMs);
  const bucketKey = `${key}:${bucket}`;
  const { data, error } = await admin.rpc("lite_rate_limit_hit", { p_key: bucketKey });
  if (error || typeof data !== "number") return fallbackRateLimited(key, windowMs, max);
  return data > max;
}
