import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";

// Server-side settings with two sources: the lite_app_config table
// (service-role only) FIRST, env var as fallback. The vault wins on purpose —
// it's operator-managed and instant, and a rotation stored there must never
// lose to a stale env var baked into an old deploy (July 12: a leftover
// PLAID_SECRET env entry overrode the rotated secret in the vault).

let cache: { values: Record<string, string>; at: number } | null = null;
const TTL_MS = 60_000;

export async function appConfig(key: string): Promise<string | undefined> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const values: Record<string, string> = {};
    const admin = getSupabaseAdmin();
    if (!admin) {
      // Name the exact missing wire — silent failures cost us a night (July 12).
      console.error(
        `[appConfig] no admin client: NEXT_PUBLIC_SUPABASE_URL=${!!process.env.NEXT_PUBLIC_SUPABASE_URL} SUPABASE_SERVICE_ROLE_KEY=${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      );
      return process.env[key]; // don't poison the cache — retry next call
    }
    const { data, error } = await admin.from("lite_app_config").select("key, value");
    if (error) {
      console.error("[appConfig] lite_app_config read failed:", error.message);
      return process.env[key]; // don't poison the cache — retry next call
    }
    for (const r of data ?? []) values[r.key] = r.value;
    console.log(`[appConfig] loaded ${Object.keys(values).length} keys: ${Object.keys(values).sort().join(",")}`);
    cache = { values, at: Date.now() };
  }
  return cache.values[key] ?? process.env[key];
}
