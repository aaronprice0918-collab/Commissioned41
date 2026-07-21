import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";

// Scan and Sort — EILA reads a batch of single-page PDFs (the F&I manager's
// scanned deal stack, split client-side) and labels every page against the
// store's jacket order. The client owns the PDF split/reassembly (pdf-lib);
// this route ONLY classifies, so no document is ever stored server-side —
// signed deal paperwork carries SSNs and stays ephemeral.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const MAX_PAGES_PER_CALL = 12;
const MAX_PAGE_BYTES = 600_000; // base64 chars per page — a 200dpi B/W scan is ~100KB

function buildPrompt(order: string[]): string {
  return `These are scanned pages from ONE signed car-deal file (a dealership "deal jacket"), in random order. Each page is preceded by a marker like "PAGE 4".

Classify EVERY page as exactly ONE document type from this store's list (use the EXACT wording):
${order.map((d) => `- ${d}`).join("\n")}

Rules:
- A multi-page document (e.g. a several-page retail contract) gets the SAME label on each of its pages.
- Use the printed titles/headings and layout to decide (e.g. "RETAIL INSTALLMENT SALE CONTRACT", odometer statement wording, a buyer's order grid, an insurance card, a credit application form).
- If a page truly matches nothing on the list, label it "Unknown". Never guess a label for a blank or illegible page — use "Unknown".
- Respond with ONLY a JSON array, no prose, no code fences: [{"page": <number from the marker>, "doc": "<label>"}] with one entry for EVERY page marker you were shown.`;
}

function extractJsonArray(text: string): { page: number; doc: string }[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((x) => x && Number.isFinite(+x.page) && typeof x.doc === "string")
      .map((x) => ({ page: +x.page, doc: x.doc }));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    // Auth-gate: signed-in users only — this endpoint spends real vision quota
    // and receives customer paperwork. Fail CLOSED in production.
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    } else {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const { data } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
      if (!data?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimit(clientKey(req), { limit: 30, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Add ANTHROPIC_API_KEY to your Vercel environment and redeploy." }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      pages?: { page?: number; data?: string }[];
      order?: string[];
    };
    const order = Array.isArray(body.order) ? body.order.filter((d) => typeof d === "string" && d.trim()).slice(0, 40) : [];
    const pages = Array.isArray(body.pages) ? body.pages : [];
    if (!order.length) return NextResponse.json({ error: "No jacket order was sent." }, { status: 400 });
    if (!pages.length) return NextResponse.json({ error: "No pages were sent." }, { status: 400 });
    if (pages.length > MAX_PAGES_PER_CALL) {
      return NextResponse.json({ error: `Send at most ${MAX_PAGES_PER_CALL} pages per request.` }, { status: 400 });
    }

    const content: unknown[] = [];
    for (const p of pages) {
      const page = Number(p?.page);
      const data = String(p?.data || "");
      if (!Number.isFinite(page) || !data) return NextResponse.json({ error: "Bad page payload." }, { status: 400 });
      if (data.length > MAX_PAGE_BYTES) {
        return NextResponse.json({ error: `Page ${page + 1} is too large — scan at a lower resolution (black & white is plenty).` }, { status: 400 });
      }
      content.push({ type: "text", text: `PAGE ${page}` });
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    }
    content.push({ type: "text", text: buildPrompt(order) });

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      // Don't log the upstream body — on a jacket scan it can echo document
      // fragments (SSN/income). Status only (SOC 2 audit L-8).
      console.error("[AI/jacket-scan] upstream error", res.status);
      return NextResponse.json({ error: "EILA couldn't read those pages — try again." }, { status: 502 });
    }

    const data = await res.json();
    const text: string = (data.content || []).find((b: { type: string }) => b.type === "text")?.text || "";
    const labels = extractJsonArray(text);
    if (!labels) return NextResponse.json({ error: "EILA's read didn't parse — try again." }, { status: 502 });

    // Every page the client sent gets a label back; anything the model skipped
    // comes back "Unknown" so no page can silently vanish from the sort.
    const byPage = new Map(labels.map((l) => [l.page, l.doc]));
    const complete = pages.map((p) => ({ page: Number(p.page), doc: byPage.get(Number(p.page)) ?? "Unknown" }));
    return NextResponse.json({ labels: complete });
  } catch (e) {
    console.error("[AI/jacket-scan]", e);
    return NextResponse.json({ error: "Scan failed — try again." }, { status: 500 });
  }
}
