import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { cronAuthorized } from "@/lib/securityLog";

// Retention for on-file customer documents — driver's-license + insurance
// images in the private `deal-docs` bucket. These carry license #, DOB,
// address, and photo, so they must not accumulate forever (SOC 2 P4.2 / audit
// H-2). Mirrors jacket-cleanup, but the deal-docs bucket is pathed
// org/<lead>/<file> (one level deeper than jackets).
//
// Retention window is conservative and env-tunable: set DEAL_DOCS_RETENTION_DAYS
// in Vercel to change it. Default 180 days — long enough to clear the active
// deal lifecycle before disposal. Confirm the value against your document
// retention policy.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_DAYS = Number(process.env.DEAL_DOCS_RETENTION_DAYS) || 180;
const BUCKET = "deal-docs";

export async function GET(req: Request) {
  // Constant-time bearer check; fail-CLOSED in production if the secret is unset.
  if (!cronAuthorized(req, "cron/deal-docs-cleanup")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseServerClient();
  if (!admin) return NextResponse.json({ error: "Service role not configured." }, { status: 503 });

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired: string[] = [];
  let scanned = 0;

  try {
    // Level 1: one folder per org.
    const { data: orgFolders, error: orgErr } = await admin.storage.from(BUCKET).list("", { limit: 1000 });
    if (orgErr) {
      if (/not found/i.test(orgErr.message)) return NextResponse.json({ ok: true, scanned: 0, deleted: 0 });
      throw new Error(`list root: ${orgErr.message}`);
    }

    for (const org of orgFolders ?? []) {
      if (org.id) continue; // skip stray root files; folders have no id
      // Level 2: one folder per lead.
      const { data: leadFolders, error: leadErr } = await admin.storage.from(BUCKET).list(org.name, { limit: 1000 });
      if (leadErr) throw new Error(`list ${org.name}: ${leadErr.message}`);
      for (const lead of leadFolders ?? []) {
        if (lead.id) continue;
        // Level 3: the license/insurance files.
        const prefix = `${org.name}/${lead.name}`;
        const { data: files, error: fileErr } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
        if (fileErr) throw new Error(`list ${prefix}: ${fileErr.message}`);
        for (const file of files ?? []) {
          if (!file.id) continue;
          scanned += 1;
          const created = new Date(file.created_at ?? file.updated_at ?? 0).getTime();
          if (Number.isFinite(created) && created > 0 && created < cutoff) {
            expired.push(`${prefix}/${file.name}`);
          }
        }
      }
    }

    for (let i = 0; i < expired.length; i += 100) {
      const chunk = expired.slice(i, i + 100);
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(chunk);
      if (rmErr) throw new Error(`remove: ${rmErr.message}`);
    }

    return NextResponse.json({ ok: true, scanned, deleted: expired.length, retentionDays: RETENTION_DAYS });
  } catch (e) {
    console.error("[cron/deal-docs-cleanup]", e);
    return NextResponse.json({ error: "cleanup failed" }, { status: 500 });
  }
}
