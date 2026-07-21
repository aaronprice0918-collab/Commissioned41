import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";

// Blue-folder retention — a filed deal-jacket PDF lives 90 days, then this
// nightly job deletes it from the private `jackets` bucket (one folder per
// org). Signed deal files carry SSNs — bounded retention is the point. The UI
// hides expired folders on its own (lib/jacketFile.ts jacketFileFresh), so a
// missed night never SHOWS a stale file — it just delays the disk delete.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_DAYS = 90; // keep in lockstep with lib/jacketFile.ts JACKET_RETENTION_DAYS

export async function GET(req: Request) {
  // Constant-time bearer check; fail-CLOSED in production if the secret is unset.
  if (!cronAuthorized(req, "cron/jacket-cleanup")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseServerClient();
  if (!admin) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired: string[] = [];
  let scanned = 0;

  try {
    // Top level of the bucket = one folder per org.
    const { data: folders, error: folderErr } = await admin.storage.from("jackets").list("", { limit: 1000 });
    if (folderErr) {
      // Bucket not created yet (nothing ever filed) — nothing to clean.
      if (/not found/i.test(folderErr.message)) return NextResponse.json({ ok: true, scanned: 0, deleted: 0 });
      throw new Error(`list root: ${folderErr.message}`);
    }

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
