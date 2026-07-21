import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { resolveDocCaller, canAccessDeal, findDealById } from "@/lib/docAuth";

// The blue folder's storage — the sorted deal-jacket PDF from Scan and Sort,
// held 90 days (lib/jacketFile.ts) in the PRIVATE `jackets` bucket, pathed by
// org and deal, served only through short-lived signed URLs. Same pattern as
// /api/deal-docs; PDFs are bigger than doc photos, hence the separate bucket
// and limit. The nightly /api/cron/jacket-cleanup deletes expired files.
// SECURITY: the jacket holds the signed credit app (SSN), driver's license and
// income docs — the most sensitive file in the store. Access is org-scoped AND
// per-deal: Sales/BDC may only touch their own deals' jackets (managers/F&I/
// admin any), mirroring the deals screen's redaction.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "jackets";
const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function ensureBucket(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "25MB", allowedMimeTypes: ["application/pdf"] });
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, orgId, role, employeeName } = await resolveDocCaller(request);
    if (!supabase) return NextResponse.json({ error: "Secure store is not connected" }, { status: 503 });
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { dealId?: string; pdf?: string; pages?: number };
    const dealId = String(body.dealId || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!dealId) return NextResponse.json({ error: "Bad request" }, { status: 400 });

    // Only the deal's own rep (or a manager/F&I/admin) may file/replace its jacket.
    const deal = await findDealById(supabase, orgId, dealId);
    if (!canAccessDeal(role, employeeName, deal)) {
      return NextResponse.json({ error: "You can only file jackets for your own deals." }, { status: 403 });
    }

    const match = String(body.pdf || "").match(/^data:application\/pdf;base64,(.+)$/);
    if (!match) return NextResponse.json({ error: "No usable PDF was sent." }, { status: 400 });
    const bytes = Buffer.from(match[1], "base64");
    if (!bytes.length || bytes.length > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "That PDF is too large to file (25MB max)." }, { status: 400 });
    }

    await ensureBucket(supabase);
    // One file per deal — a re-sort replaces it (and restarts the 90 days).
    const path = `${orgId}/${dealId}.pdf`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const pages = Math.max(0, Math.round(Number(body.pages) || 0));
    return NextResponse.json({ path, pages, savedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Could not file the PDF" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, orgId, role, employeeName } = await resolveDocCaller(request);
    if (!supabase) return NextResponse.json({ error: "Secure store is not connected" }, { status: 503 });
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const path = request.nextUrl.searchParams.get("path") || "";
    // Tenant isolation: a signed URL is only ever minted for a path inside the
    // caller's own org folder.
    if (!path.startsWith(`${orgId}/`)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Per-deal authorization: the path is `${orgId}/${dealId}.pdf` — resolve the
    // deal and enforce the same ownership rule as the deals screen. A blind
    // org-only check let any rep pull any deal's credit app / license.
    const dealId = path.slice(`${orgId}/`.length).replace(/\.pdf$/i, "");
    const deal = await findDealById(supabase, orgId, dealId);
    if (!canAccessDeal(role, employeeName, deal)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ url: data.signedUrl });
  } catch {
    return NextResponse.json({ error: "Could not open the file" }, { status: 500 });
  }
}
