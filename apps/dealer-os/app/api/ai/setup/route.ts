import { NextResponse } from "next/server";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
import { docTypeDef, type DocType } from "@/lib/monthlySetup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// AI parse of an uploaded monthly-setup doc (often vision) can run past the
// default timeout; give it headroom so a large upload doesn't 504.
export const maxDuration = 60;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
// Same engine as the rest of EILA — extracting a rate sheet wrong costs the
// store real money on every quote, so use the most capable model.
const SETUP_MODEL = "claude-opus-4-8";

// Monthly setup rewrites the store's reference data — owner/admin only.
async function resolveSetupCaller(req: Request): Promise<{ ok: boolean }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: process.env.NODE_ENV !== "production" };
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false };
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return { ok: false };
  if (isOwnerEmail(data.user.email)) return { ok: true };
  const { data: profile } = await supabase
    .from("user_profiles").select("role, org_id").eq("id", data.user.id).maybeSingle();
  void DEFAULT_ORG_ID; // setup data is store-wide reference; org scoping happens on the client save
  return { ok: normalizeAccessRole(profile?.role) === "Admin" };
}

// One forced tool per doc type so the model returns exactly the shape lib/monthlySetup expects.
const TOOLS: Record<DocType, any> = {
  rateSheets: {
    name: "submit_rate_sheet",
    description: "Return the lender buy-rate sheet parsed from the document.",
    input_schema: {
      type: "object",
      properties: {
        effectiveMonth: { type: "string", description: "Effective month/period if shown, e.g. 'June 2026'." },
        lenders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              lender: { type: "string", description: "Lender/bank/credit-union name as shown." },
              tiers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    tier: { type: "string", description: "Credit tier label, e.g. 'Tier 1 (720+)' or 'A+'." },
                    rates: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          year: { type: "string", description: "Vehicle model-year band this rate applies to if the sheet tiers by vehicle age, e.g. '2024 & Newer', '2023', '2021'. Emit ONE rate entry per year×term cell — do NOT collapse years. Omit only if the sheet doesn't vary rate by vehicle year." },
                          termMonths: { type: "number", description: "Term in months, e.g. 72." },
                          buyRate: { type: "number", description: "BUY rate as a percent number, e.g. 6.49 for 6.49%. Skip cells that are blank, 'N/A', or 'TBD'/'rate at approval'." },
                          minAmountFinanced: { type: "number", description: "Minimum amount financed for this row if shown, e.g. 25000. Strip $ and commas." },
                          maxAdvancePct: { type: "number", description: "Max advance / LTV percent if shown." },
                        },
                        required: ["termMonths", "buyRate"],
                      },
                    },
                  },
                  required: ["tier", "rates"],
                },
              },
              notes: { type: "string", description: "Any per-lender note (acq fee, reserve cap, age/mileage limits)." },
            },
            required: ["lender", "tiers"],
          },
        },
        notes: { type: "string" },
        summary: { type: "string", description: "One line: how many lenders/tiers and anything you were unsure about." },
      },
      required: ["lenders"],
    },
  },
  incentives: {
    name: "submit_incentives",
    description: "Return the OEM incentive/rebate offers parsed from the document.",
    input_schema: {
      type: "object",
      properties: {
        effectiveMonth: { type: "string" },
        offers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              model: { type: "string", description: "Model/trim the offer applies to, or 'All'." },
              offerType: { type: "string", description: "e.g. 'Customer Cash', 'Special APR', 'Lease Cash', 'Loyalty'." },
              detail: { type: "string", description: "The offer detail, e.g. '$2,000' or '1.9% up to 60mo'." },
              expires: { type: "string", description: "Expiration date if shown (YYYY-MM-DD)." },
            },
            required: ["model", "offerType", "detail"],
          },
        },
        notes: { type: "string" },
        summary: { type: "string" },
      },
      required: ["offers"],
    },
  },
  residuals: {
    name: "submit_residuals",
    description: "Return the lease residual / money-factor rows parsed from the document.",
    input_schema: {
      type: "object",
      properties: {
        effectiveMonth: { type: "string" },
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              model: { type: "string" },
              termMonths: { type: "number" },
              mileage: { type: "number", description: "Annual mileage in THOUSANDS, e.g. 12 for 12k." },
              residualPct: { type: "number", description: "Residual as a percent number, e.g. 58 for 58%." },
              moneyFactor: { type: "number", description: "Money factor if shown, e.g. 0.00125." },
            },
            required: ["model", "termMonths", "mileage", "residualPct"],
          },
        },
        notes: { type: "string" },
        summary: { type: "string" },
      },
      required: ["rows"],
    },
  },
};

function systemFor(docType: DocType): string {
  const def = docTypeDef(docType);
  const rateSheetNote = docType === "rateSheets"
    ? `\n\nRATE-SHEET GRIDS: bank/credit-union sheets often grid the buy rate by THREE axes at once — credit tier (columns), term (rows), and VEHICLE MODEL-YEAR (row groups like "2024 & Newer", "2023", "2022"…). Emit ONE rate entry for EVERY filled cell: a 2024 66mo A+ and a 2020 66mo A+ are SEPARATE entries with the same tier but different \`year\` and \`buyRate\`. Never collapse years or report only one year — losing the year makes every quote wrong. Put cross-cutting rules (reserve/flat, max advance %, GAP cost, backend caps, member rules) into the lender \`notes\`.`
    : "";
  return `You are EILA, the data-intake engine inside Dealer Mission OS. You convert a dealership reference document into clean structured data. This document is ${def.examples}

RULES:
- Output ONLY via the provided tool. Extract EVERY row/offer you can read.
- Percentages are plain numbers: "6.49%" -> 6.49, "58%" -> 58. Strip "$" and commas from money.
- Do NOT invent values. If a cell is blank or "—", omit that entry rather than guessing.
- Preserve the source's own labels (tier names, model names) verbatim — don't normalize them.
- If you genuinely can't find any of the expected data, return an empty list and say so in summary.${rateSheetNote}`;
}

type Body = { docType?: DocType; text?: string; fileBase64?: string; mediaType?: string; fileName?: string };

export async function POST(req: Request) {
  try {
    const { ok } = await resolveSetupCaller(req);
    if (!ok) {
      return NextResponse.json({ error: "Monthly setup is available to owners/admins only." }, { status: 403 });
    }
    const rl = await rateLimit(clientKey(req), { limit: 10, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);
    const { docType = "rateSheets", text, fileBase64, mediaType } = (await req.json()) as Body;
    if (!TOOLS[docType]) {
      return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
    }
    const hasText = !!text && text.trim().length > 0;
    const hasFile = !!fileBase64 && !!mediaType;
    if (!hasText && !hasFile) {
      return NextResponse.json({ error: "Drop a PDF or paste the sheet first." }, { status: 400 });
    }
    if (text && text.length > 400_000) {
      return NextResponse.json({ error: "That's too large to parse at once — split it into smaller batches." }, { status: 413 });
    }
    // Base64 of a PDF is ~1.37x the file; ~14MB b64 ≈ a 10MB PDF.
    if (fileBase64 && fileBase64.length > 14_000_000) {
      return NextResponse.json({ error: "That file is too large — keep PDFs under ~10MB." }, { status: 413 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Add ANTHROPIC_API_KEY to your Vercel environment variables and redeploy." },
        { status: 500 }
      );
    }

    const tool = TOOLS[docType];
    const content: any[] = [];
    if (hasFile) {
      content.push({
        type: "document",
        source: mediaType === "application/pdf"
          ? { type: "base64", media_type: "application/pdf", data: fileBase64 }
          : { type: "text", media_type: "text/plain", data: fileBase64 },
      });
    }
    content.push({ type: "text", text: hasText ? `Parse this ${docType} document:\n\n${text}` : `Parse the attached ${docType} document.` });

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: SETUP_MODEL,
        max_tokens: 16000,
        system: systemFor(docType),
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: `EILA couldn't read that (${res.status}). ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const json = await res.json();
    const toolUse = (json.content || []).find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse?.input) {
      return NextResponse.json({ error: "EILA didn't find anything to extract in that document." }, { status: 422 });
    }
    const { summary, ...data } = toolUse.input;
    return NextResponse.json({ data, summary: summary ?? "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Setup parse failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
