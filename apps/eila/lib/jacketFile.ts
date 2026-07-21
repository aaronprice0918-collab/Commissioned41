// The blue folder — EILA holds the sorted deal-jacket PDF for 90 days on the
// deal card, then lets it go (a scheduled cleanup deletes expired files, see
// /api/cron/jacket-cleanup). The file lives in the PRIVATE `jackets` storage
// bucket under the user's own auth folder (owner-only RLS, PDFs only) —
// signed deal paperwork carries SSNs, so retention is deliberately bounded:
// long enough for "the bank kicked it back", never a permanent archive.

import { getSupabase } from "./supabase";

export const JACKET_RETENTION_DAYS = 90;

export interface JacketFileRef {
  path: string; // storage path: <uid>/<dealId>.pdf
  pages: number;
  savedAt: string; // ISO
}

/** Still inside the 90-day window? (UI hides the folder the moment it's not;
 * the nightly cleanup deletes the object itself.) */
export function jacketFileFresh(file: JacketFileRef | undefined | null, now = new Date()): boolean {
  if (!file?.path || !file.savedAt) return false;
  const saved = new Date(file.savedAt).getTime();
  if (!Number.isFinite(saved)) return false;
  return now.getTime() - saved < JACKET_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/** Days left before EILA lets the file go (0 when expired). */
export function jacketFileDaysLeft(file: JacketFileRef, now = new Date()): number {
  const saved = new Date(file.savedAt).getTime();
  if (!Number.isFinite(saved)) return 0;
  const left = JACKET_RETENTION_DAYS - (now.getTime() - saved) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(left));
}

/** Upload the sorted jacket to the user's folder (one file per deal — a
 * re-sort replaces it). Returns the ref to store on the deal. */
export async function uploadJacketFile(userId: string, dealId: string, bytes: Uint8Array, pages: number): Promise<JacketFileRef> {
  const sb = getSupabase();
  if (!sb) throw new Error("Storage isn't available right now.");
  const path = `${userId}/${dealId}.pdf`;
  const { error } = await sb.storage
    .from("jackets")
    .upload(path, new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
  if (error) throw new Error(`Couldn't file the PDF: ${error.message}`);
  return { path, pages, savedAt: new Date().toISOString() };
}

/** Open the filed jacket in a new tab via a short-lived signed URL. */
export async function openJacketFile(path: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Storage isn't available right now.");
  const { data, error } = await sb.storage.from("jackets").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error("Couldn't open the file — it may have expired.");
  window.open(data.signedUrl, "_blank", "noopener");
}
