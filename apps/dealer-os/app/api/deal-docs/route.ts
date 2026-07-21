import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { resolveDocCaller, canAccessLead, findLeadById } from "@/lib/docAuth";

// On-file customer documents — a photo of the driver's license and the
// insurance card, kept with the deal. They live in a PRIVATE Supabase Storage
// bucket (never public), pathed by org and lead, and are only ever served back
// through a short-lived signed URL. The lead record stores just the path, so the
// big JSONB leads blob stays small.
// SECURITY: driver's-license and insurance images are sensitive PII. Access is
// org-scoped AND per-lead — mirroring the leads screen, only Sales is restricted
// to its own book (BDC/F&I/manager/admin see the store). A blind org-only check
// let any rep pull any customer's license image.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "deal-docs";
const KINDS = new Set(["license", "insurance"]);

async function ensureBucket(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>) {
  const { data } = await supabase.storage.getBucket(BUCKET);
  if (data) return;
  await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: "8MB" });
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, orgId, role, employeeName } = await resolveDocCaller(request);
    if (!supabase) return NextResponse.json({ error: "Secure store is not connected" }, { status: 503 });
    if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { leadId?: string; kind?: string; image?: string };
    const leadId = String(body.leadId || "").replace(/[^A-Za-z0-9_-]/g, "");
    const kind = String(body.kind || "");
    if (!leadId || !KINDS.has(kind)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    // A Sales rep may only attach docs to their own lead. A not-yet-saved lead
    // (null) is allowed — that's the create flow; we only block claiming a lead
    // that already belongs to someone else.
    const existingLead = await findLeadById(supabase, orgId, leadId);
    if (existingLead && !canAccessLead(role, employeeName, existingLead)) {
      return NextResponse.json({ error: "You can only add documents to your own leads." }, { status: 403 });
    }

    const match = String(body.image || "").match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) return NextResponse.json({ error: "No usable image was sent." }, { status: 400 });
    const contentType = match[1];
    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const bytes = Buffer.from(match[2], "base64");

    await ensureBucket(supabase);
    const path = `${orgId}/${leadId}/${kind}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) {
      console.error("[deal-docs] upload failed:", error.message);
      return NextResponse.json({ error: "Could not save the document" }, { status: 500 });
    }

    return NextResponse.json({ path });
  } catch {
    return NextResponse.json({ error: "Could not save the document" }, { status: 500 });
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
    // Per-lead authorization: the path is `${orgId}/${leadId}/${kind}.ext` —
    // resolve the lead and enforce the leads-screen rule (Sales own-only).
    const leadId = path.slice(`${orgId}/`.length).split("/")[0];
    const lead = await findLeadById(supabase, orgId, leadId);
    if (!canAccessLead(role, employeeName, lead)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
    if (error || !data?.signedUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ url: data.signedUrl });
  } catch {
    return NextResponse.json({ error: "Could not load the document" }, { status: 500 });
  }
}
