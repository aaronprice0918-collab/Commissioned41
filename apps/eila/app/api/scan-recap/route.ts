import { NextResponse } from "next/server";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { rateLimited } from "@/lib/rateLimit";

// EILA reads a photo of a deal recap / washout sheet (the DMS printout an F&I
// manager works from) and extracts the whole deal — customer, deal #, money,
// bank, salesperson, products — so logging a deal is: snap, glance, save.
// Same gate/throttle/size pattern as scan-license. The user's own product
// menu rides in so product mentions map onto THEIR names, not a fixed list.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL; // any Vercel deploy (previews too) enforces the gate — only true local dev gets the convenience pass
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

const MAX_IMAGE_BYTES = 6_000_000;

function buildPrompt(productMenu: string[]): string {
  return `You are reading a photo of a car-deal recap / washout / deal jacket summary sheet from a dealership DMS. Extract the deal's details.

Respond with ONLY a JSON object — no prose, no code fences — with exactly these keys:
{
  "customer": "",
  "dealNumber": "",
  "vehicle": "",
  "category": "",
  "bank": "",
  "salesperson": "",
  "salesperson2": "",
  "frontGross": 0,
  "backGross": 0,
  "reserve": 0,
  "products": []
}

Rules:
- customer in proper Title Case.
- vehicle = short form like "26 CX-5" (year + model).
- category = "new", "used", or "lease" if determinable, else "".
- frontGross / backGross / reserve = numbers (negatives allowed, no $ or commas). backGross = the F&I/back-end gross (often labeled F&I gross, back end, or adjusted F&I net). If only a total product gross is shown, use it as backGross.
- salesperson / salesperson2 = the selling salesperson name(s), NOT the F&I manager or sales manager. Title Case.
- products = which of the user's F&I products appear SOLD on this deal. Choose ONLY from this exact list (return the exact strings): ${JSON.stringify(productMenu)}. A service contract/VSC/warranty maps to the VSC-like item; gap insurance to the GAP-like item; maintenance/prepaid maintenance to the maintenance-like item; bundles to the bundle-like item. Omit anything not clearly sold.
- If a field isn't on the sheet, use "" (or 0 for numbers, [] for products).
- If the image is clearly NOT a deal document, respond with {"error":"not a deal recap"}.`;
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const email = await getSessionEmail(token);
    if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    if (await rateLimited(`scan-recap:${email}`, RATE_WINDOW_MS, RATE_MAX)) return NextResponse.json({ error: "Too many scans. Try again shortly." }, { status: 429 });

    let active = false;
    try { active = await hasActiveSubscription(email); } catch { active = false; }
    if (!active && IS_PROD) return NextResponse.json({ error: "Subscription required." }, { status: 402 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Scanner isn't configured." }, { status: 503 });

    const body = (await req.json().catch(() => ({}))) as { image?: string; productMenu?: string[] };
    const image = body.image || "";
    const menu = (Array.isArray(body.productMenu) ? body.productMenu : []).map(String).slice(0, 20);
    if (image.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Photo too large — retake it." }, { status: 413 });
    const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) return NextResponse.json({ error: "No usable image was sent." }, { status: 400 });

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
          { type: "text", text: buildPrompt(menu) },
        ] }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: "EILA couldn't read that one — retake it sharp and well-lit." }, { status: 502 });

    const out = await res.json();
    const textBlock = Array.isArray(out?.content) ? out.content.find((c: { type?: string }) => c?.type === "text") : null;
    const fields = extractJson(textBlock?.text || "");
    if (!fields || (fields as { error?: string }).error) {
      return NextResponse.json({ error: "That didn't look like a deal recap. Lay it flat, good light, fill the frame." }, { status: 422 });
    }

    const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : parseFloat(String(v).replace(/[^0-9.-]/g, "")) || 0);
    const str = (v: unknown) => String(v ?? "").trim();
    const cat = str(fields.category).toLowerCase();
    return NextResponse.json({
      customer: str(fields.customer),
      dealNumber: str(fields.dealNumber),
      vehicle: str(fields.vehicle),
      category: ["new", "used", "lease"].includes(cat) ? cat : "",
      bank: str(fields.bank),
      salesperson: str(fields.salesperson),
      salesperson2: str(fields.salesperson2),
      frontGross: num(fields.frontGross),
      backGross: num(fields.backGross),
      reserve: num(fields.reserve),
      products: (Array.isArray(fields.products) ? fields.products : []).map(String).filter((p) => menu.includes(p)),
    });
  } catch (e) {
    console.error("[scan-recap]", e);
    return NextResponse.json({ error: "Something went wrong reading the recap — try again." }, { status: 500 });
  }
}
