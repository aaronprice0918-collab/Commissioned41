// The blue folder — the sorted deal-jacket PDF filed on the deal for 90 days,
// then let go (a nightly cron deletes expired files; the UI hides them the
// moment the window closes, so a missed night never shows a stale file).
// Signed deal paperwork carries SSNs, so retention is deliberately bounded:
// long enough for "the bank kicked it back", never a permanent archive.
// Files live in the PRIVATE `jackets` storage bucket, pathed by org, served
// only through short-lived signed URLs minted by /api/jacket-file.

export const JACKET_RETENTION_DAYS = 90;

export interface JacketFileRef {
  path: string; // storage path: <orgId>/<dealId>.pdf
  pages: number;
  savedAt: string; // ISO
}

/** Still inside the 90-day window? */
export function jacketFileFresh(file: JacketFileRef | undefined | null, now = new Date()): boolean {
  if (!file?.path || !file.savedAt) return false;
  const saved = new Date(file.savedAt).getTime();
  if (!Number.isFinite(saved)) return false;
  return now.getTime() - saved < JACKET_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/** Days left before the file is let go (0 when expired). */
export function jacketFileDaysLeft(file: JacketFileRef, now = new Date()): number {
  const saved = new Date(file.savedAt).getTime();
  if (!Number.isFinite(saved)) return 0;
  const left = JACKET_RETENTION_DAYS - (now.getTime() - saved) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(left));
}
