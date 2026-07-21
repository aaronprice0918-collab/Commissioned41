"use client";

import { createClient } from "@supabase/supabase-js";

export function getSupabaseBrowserClient() {
  const url = firstUsableValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publicKey = firstUsablePublicKey(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  if (!url || !publicKey) return null;

  return createClient(url, publicKey);
}

function firstUsableValue(...values: Array<string | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) || "";
}

function firstUsablePublicKey(...values: Array<string | undefined>) {
  const cleaned = values.map((value) => value?.trim()).filter(Boolean) as string[];
  return cleaned.find((value) => value.startsWith("sb_publishable_")) || cleaned.find(isJwtLikeKey) || "";
}

function isJwtLikeKey(value: string) {
  return value.split(".").length === 3;
}
