import { NextResponse } from "next/server";

// Lightweight fixed-window rate limiter backed by Upstash Redis's REST API,
// with an always-on in-memory fallback so it NEVER fully fails open.
//
// Design choices that matter:
// - **Never fully fails open.** Upstash is the primary limiter when configured.
//   If Upstash isn't configured (no env vars) OR an Upstash call errors / times
//   out / returns non-200, we fall back to a per-process in-memory limiter that
//   enforces the SAME limit. That keeps a real (if per-instance) cost ceiling on
//   the AI endpoints instead of letting requests through unbounded. We do NOT
//   hard fail-closed: that would take the app down whenever Redis hiccups.
// - **In-memory floor is per-process.** On serverless this is per warm instance,
//   not global, so it's a floor and not a precise global cap — but it is always
//   present. With Upstash configured you get the precise distributed cap.
// - **No SDK dependency.** Talks to Upstash over plain fetch (its REST pipeline),
//   so there's nothing new in package.json to maintain.
// - **Fixed window** (INCR + EXPIRE). Simple and more than enough to stop cost
//   abuse of the AI endpoints; not trying to be a precise sliding window.

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export type RateResult = { ok: boolean; remaining: number; limit: number };

// Module-level per-process counters for the in-memory fallback limiter. Keyed by
// `${identifier}:${bucket}` (same fixed-window bucketing as the Upstash path) so
// stale buckets naturally stop being incremented; we also prune them lazily.
const memCounts = new Map<string, number>();

function memoryLimit(identifier: string, limit: number, windowSec: number): RateResult {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `${identifier}:${bucket}`;
  // Lazily drop any keys from older windows so the Map can't grow unbounded.
  const suffix = `:${bucket}`;
  if (memCounts.size > 1000) {
    for (const k of memCounts.keys()) {
      if (!k.endsWith(suffix)) memCounts.delete(k);
    }
  }
  const count = (memCounts.get(key) ?? 0) + 1;
  memCounts.set(key, count);
  return { ok: count <= limit, remaining: Math.max(0, limit - count), limit };
}

export async function rateLimit(
  identifier: string,
  opts?: { limit?: number; windowSec?: number }
): Promise<RateResult> {
  const limit = opts?.limit ?? 30;
  const windowSec = opts?.windowSec ?? 60;

  // Not configured → fall back to the in-memory per-process limiter (never fully
  // fails open).
  if (!REST_URL || !REST_TOKEN) return memoryLimit(identifier, limit, windowSec);

  try {
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${identifier}:${bucket}`;
    const res = await fetch(`${REST_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(windowSec)],
      ]),
      cache: "no-store",
    });
    // Upstash unavailable → fall back to the in-memory floor instead of failing open.
    if (!res.ok) return memoryLimit(identifier, limit, windowSec);
    const data = (await res.json()) as Array<{ result?: number }>;
    const count = Number(data?.[0]?.result ?? 0);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), limit };
  } catch {
    // Any limiter error → in-memory floor (never fully fails open).
    return memoryLimit(identifier, limit, windowSec);
  }
}

// Best-effort caller identity: the authenticated user id when we have one,
// otherwise the client IP from the proxy headers. Falls back to a constant so a
// missing IP still shares one bucket rather than bypassing the limit per-call.
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

export function tooManyRequests(result: RateResult) {
  return NextResponse.json(
    { error: "Too many requests — give it a few seconds and try again." },
    {
      status: 429,
      headers: {
        "Retry-After": "30",
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    }
  );
}
