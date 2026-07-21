import { getSupabaseServerClient } from "@/lib/supabaseServer";

type Supa = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

// Server-side compare-and-swap for the `app_store` key-value table.
//
// EILA writes from the AI route (update_lead, remember_*, memory reflection) run
// server-side and used to do a blind read-modify-UPSERT of the whole JSONB blob.
// That silently clobbers a concurrent edit: a rep saves a CRM change on their
// phone while EILA writes a note from the same array she read a moment earlier —
// last write wins, the rep's edit vanishes. The client + the store route already
// guard against this with a conditional update (x-store-if-version). This gives
// the server path the SAME protection: read the row's version, apply the mutation,
// and only commit if the row still carries that version; on a conflict, re-read
// and re-apply against fresh data. The mutator MUST be pure (current -> next) and
// re-runnable, since it can run several times across retries.
export async function guardedMutate<T>(
  supabase: Supa,
  orgId: string,
  key: string,
  mutate: (current: T | null) => T,
  tries = 5,
): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const { data: row } = await supabase
      .from("app_store")
      .select("value, updated_at")
      .eq("org_id", orgId)
      .eq("key", key)
      .maybeSingle();
    const next = mutate((row?.value ?? null) as T | null);
    const nowIso = new Date().toISOString();

    if (row) {
      // Conditional update: only lands if nobody wrote since our read.
      const { data: swapped, error } = await supabase
        .from("app_store")
        .update({ value: next, updated_at: nowIso })
        .eq("org_id", orgId)
        .eq("key", key)
        .eq("updated_at", row.updated_at as string)
        .select("updated_at");
      if (error) throw new Error(error.message);
      if (swapped && swapped.length > 0) return; // won the swap
      // else: someone else wrote between our read and update — retry with fresh data.
    } else {
      // No row yet — a legitimate first write. INSERT (not upsert) so a racing
      // first-writer can't be silently overwritten; on a unique conflict we loop
      // and treat the now-existing row via the CAS path above.
      const { error } = await supabase
        .from("app_store")
        .insert({ org_id: orgId, key, value: next, updated_at: nowIso });
      if (!error) return;
      // insert conflict (row appeared) — fall through to retry as an update.
    }
  }
  throw new Error(`store write conflict on "${key}" (retries exhausted)`);
}
