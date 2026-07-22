import { NextResponse } from "next/server";

// Shared rate limiter for Commissioned 41 apps.
//
// Lightweight fixed-window rate limiter backed by Upstash Redis's REST API,
// with an always-on in-memory fallback so it NEVER fully fails open.
//
// Design choices:
// - **Never fully fails open.** Upstash is the primary limiter when configured.
//   If Upstash isn't configured OR an Upstash call errors, we fall back to a
//   per-process in-memory limiter that enforces the SAME limit.
// - **In-memory floor is per-process.** On serverless this is per warm instance,
//   not global, so it's a floor and not a precise global cap — but it is always
//   present. With Upstash configured you get the precise distributed cap.
// - **No SDK dependency.** Talks to Upstash over plain fetch (its REST pipeline).
// - **Fixed window** (INCR + EXPIRE). Simple and more than enough to stop cost
//   abuse; not trying to be a precise sliding window.

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export type RateResult = { ok: boolean; remaining: number; limit: number };

// Module-level per-process counters for the in-memory fallback limiter.
const memCounts = new Map<string, number>();

function memoryLimit(identifier: string, limit: number, windowSec: number): RateResult {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `${identifier}:${bucket}`;
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
    if (!res.ok) return memoryLimit(identifier, limit, windowSec);
    const data = (await res.json()) as Array<{ result?: number }>;
    const count = Number(data?.[0]?.result);
    // A 200 with an unexpected body shape must NOT read as count=0 (which would
    // make ok=true forever — a silent fail-open). Treat a non-numeric result as
    // a backend failure and fall back to the bounded in-memory limiter.
    if (!Number.isFinite(count)) return memoryLimit(identifier, limit, windowSec);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), limit };
  } catch {
    return memoryLimit(identifier, limit, windowSec);
  }
}

// Best-effort caller identity: the authenticated user id when we have one,
// otherwise the client IP from the proxy headers.
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

/** Best-effort client IP from the x-forwarded-for chain (first hop). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || "unknown";
}

export function tooManyRequests(result: RateResult) {
  return NextResponse.json(
    { error: "Too many requests \u2014 give it a few seconds and try again." },
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
