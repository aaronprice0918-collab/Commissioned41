import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Scan and Sort retention — EILA holds a sorted deal-jacket PDF for 90 days
// (the blue folder on the deal card), then lets it go. This nightly job is
// that promise: it walks the private `jackets` bucket and deletes anything
// older than the window. Signed deal files carry SSNs — bounded retention is
// the point, so this job failing loudly matters more than it succeeding
// quietly. The UI hides expired folders on its own (jacketFileFresh), so a
// missed night never SHOWS a stale file — it just delays the disk delete.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_DAYS = 90; // keep in lockstep with lib/jacketFile.ts JACKET_RETENTION_DAYS

export async function GET(req: Request) {
  // Fail CLOSED if CRON_SECRET is missing — same rationale as the other crons.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Cron not configured." }, { status: 503 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired: string[] = [];
  let scanned = 0;

  try {
    // Top level of the bucket = one folder per user (auth.uid()).
    const { data: folders, error: folderErr } = await admin.storage.from("jackets").list("", { limit: 1000 });
    if (folderErr) throw new Error(`list root: ${folderErr.message}`);

    for (const folder of folders ?? []) {
      // Files have ids; folders don't. Skip stray root-level files just in case.
      if (folder.id) continue;
      const { data: files, error: fileErr } = await admin.storage.from("jackets").list(folder.name, { limit: 1000 });
      if (fileErr) throw new Error(`list ${folder.name}: ${fileErr.message}`);
      for (const file of files ?? []) {
        if (!file.id) continue;
        scanned += 1;
        const created = new Date(file.created_at ?? file.updated_at ?? 0).getTime();
        if (Number.isFinite(created) && created > 0 && created < cutoff) {
          expired.push(`${folder.name}/${file.name}`);
        }
      }
    }

    // Remove in chunks — storage.remove takes a list.
    for (let i = 0; i < expired.length; i += 100) {
      const chunk = expired.slice(i, i + 100);
      const { error: rmErr } = await admin.storage.from("jackets").remove(chunk);
      if (rmErr) throw new Error(`remove: ${rmErr.message}`);
    }

    return NextResponse.json({ ok: true, scanned, deleted: expired.length });
  } catch (e) {
    console.error("[cron/jacket-cleanup]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "cleanup failed" }, { status: 500 });
  }
}
