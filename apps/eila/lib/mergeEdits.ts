// Save-time merge for "frozen draft" editors.
//
// An editor (Settings' pay-plan form, a deal's Edit form, the product menu)
// seeds a local DRAFT from the store when it opens, then the user edits fields
// and taps Save. If Save writes the WHOLE draft back, any field changed by
// SOMEONE ELSE while the editor was open — EILA running a tool, a cloud-sync
// pull from another device — gets stamped back to its old value. That's the
// "I set my goal to $20k, it reverted to $6k" class of bug.
//
// The fix: on save, write only the fields the user ACTUALLY changed (draft vs
// the baseline captured when the editor opened), merged onto the LATEST value.
// Because our editors build each edit as a shallow spread ({ ...obj, ...patch }),
// an untouched top-level key keeps its exact reference from the baseline, so a
// shallow key-by-key comparison identifies precisely what the user touched —
// nothing more.

/** The subset of `draft` whose top-level values differ from `baseline`
 *  (including keys the user cleared to undefined, and keys the user added). */
export function changedFields<T extends object>(baseline: T, draft: T): Partial<T> {
  const out: Partial<T> = {};
  const keys = new Set<string>([...Object.keys(baseline), ...Object.keys(draft)]);
  for (const k of keys) {
    if ((draft as Record<string, unknown>)[k] !== (baseline as Record<string, unknown>)[k]) {
      (out as Record<string, unknown>)[k] = (draft as Record<string, unknown>)[k];
    }
  }
  return out;
}

/** `live` with only the user's changes (draft vs baseline) laid over it — so a
 *  concurrent writer that touched a DIFFERENT field survives the save. */
export function mergeUserEdits<T extends object>(live: T, baseline: T, draft: T): T {
  return { ...live, ...changedFields(baseline, draft) };
}

/** Per-item three-way merge for a keyed LIST edited in a sheet (bills, goals,
 *  budget categories) while another writer — an EILA tool, a cloud pull — may
 *  have changed the same list. Field-level diffing can't protect list items
 *  (any row edit changes the whole array), so this merges row by row:
 *  - a row the user edited or added → the user's version wins;
 *  - a row the user did NOT touch → the latest (elsewhere-written) version
 *    wins, including its removal (no resurrections);
 *  - a row the user deleted in the sheet → stays deleted;
 *  - a row added elsewhere mid-edit → kept.
 *  Rows compare by deep value against the seed to detect a real user edit. */
export function mergeListBy<T>(key: (t: T) => string, seeded: T[], draft: T[], latest: T[]): T[] {
  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  const seedBy = new Map(seeded.map((t) => [key(t), t]));
  const draftKeys = new Set(draft.map(key));
  const latestBy = new Map(latest.map((t) => [key(t), t]));
  const out: T[] = [];
  for (const d of draft) {
    const s = seedBy.get(key(d));
    if (!s) { out.push(d); continue; } // user-added row
    const userEdited = !same(d, s);
    const l = latestBy.get(key(d));
    if (!l) { if (userEdited) out.push(d); } // removed elsewhere — respect it unless the user was editing that row
    else out.push(userEdited ? d : l);
  }
  for (const l of latest) if (!seedBy.has(key(l)) && !draftKeys.has(key(l))) out.push(l); // added elsewhere
  return out;
}
