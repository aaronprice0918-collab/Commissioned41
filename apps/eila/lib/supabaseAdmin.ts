import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the SERVICE ROLE key. This bypasses RLS, so
// it must NEVER be imported into client code — it lives only in API routes that
// run on the server (the Stripe webhook + entitlement read). Returns null when
// the service key isn't set, so the app keeps working (falling back to a live
// Stripe lookup) before the entitlements table is wired up.
//
// The service role key is the master key for the database. It is read from
// SUPABASE_SERVICE_ROLE_KEY (a server-only env var — note: NOT prefixed with
// NEXT_PUBLIC_, so it is never shipped to the browser).
let cached: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  return cached;
}

// The table the Stripe webhook writes entitlement state into and the entitlement
// check reads from. One row per billing email.
export const ENTITLEMENTS_TABLE = "lite_entitlements";
