"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Single browser client. Returns null when the project isn't configured (env
// vars absent) — the app then runs fully on-device, no sync. Cloud sync + auth
// light up automatically once NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are set.
let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && anon ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
  return client;
}

export const STATE_TABLE = "lite_state";
