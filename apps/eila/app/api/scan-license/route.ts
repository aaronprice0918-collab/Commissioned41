import { NextResponse } from "next/server";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { rateLimited } from "@/lib/rateLimit";

// EILA reads a photo of a driver's license / state ID (the human-readable FRONT)
// and returns the customer's name — no barcode SDK, a fraction of a cent per
// scan. Ported from the battle-tested Dealer Mission OS scanner, gated the
// same way as parse-payplan: signed-in + subscribed, throttled, size-capped.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL; // any Vercel deploy (previews too) enforces the gate — only true local dev gets the convenience pass
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;

const MAX_IMAGE_BYTES = 6_000_000; // ~4.5MB image as base64

const PROMPT = `You are reading a photo of a US driver's license (or state ID). Extract the person's details from the FRONT of the card.

Respond with ONLY a JSON object — no prose, no code fences — with exactly these keys:
{
  "firstName": "",
  "lastName": "",
  "city": "",
  "state": ""
}

Rules:
- Names in proper Title Case (e.g. "John"), not ALL CAPS.
- state = the 2-letter abbreviation (e.g. "GA").
- If a field isn't clearly visible, use "".
- If the image is not a driver's license or ID, respond with {"error":"not a license"}.`;

function extractJson(text: string): Record<string, string> | null {
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
    if (await rateLimited(`scan-license:${email}`, RATE_WINDOW_MS, RATE_MAX)) return NextResponse.json({ error: "Too many scans. Try again shortly." }, { status: 429 });

    let active = false;
    try { active = await hasActiveSubscription(email); } catch { active = false; }
    if (!active && IS_PROD) return NextResponse.json({ error: "Subscription required." }, { status: 402 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Scanner isn't configured." }, { status: 503 });

    const body = (await req.json().catch(() => ({}))) as { image?: string };
    const image = body.image || "";
    if (image.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Photo too large — retake it." }, { status: 413 });
    const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) return NextResponse.json({ error: "No usable image was sent." }, { status: 400 });

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
          { type: "text", text: PROMPT },
        ] }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: "EILA couldn't read that one — retake it sharp and well-lit." }, { status: 502 });

    const out = await res.json();
    const textBlock = Array.isArray(out?.content) ? out.content.find((c: { type?: string }) => c?.type === "text") : null;
    const fields = extractJson(textBlock?.text || "");
    if (!fields || (fields as { error?: string }).error) {
      return NextResponse.json({ error: "That didn't look like an ID. Capture the FRONT — flat, well-lit, filling the frame." }, { status: 422 });
    }

    const first = String(fields.firstName ?? "").trim();
    const last = String(fields.lastName ?? "").trim();
    const customer = [first, last].filter(Boolean).join(" ");
    if (!customer) return NextResponse.json({ error: "Couldn't make out the name — retake it closer." }, { status: 422 });
    return NextResponse.json({
      customer,
      city: String(fields.city ?? "").trim(),
      state: String(fields.state ?? "").trim().toUpperCase().slice(0, 2),
    });
  } catch (e) {
    console.error("[scan-license]", e);
    return NextResponse.json({ error: "Something went wrong reading the ID — try again." }, { status: 500 });
  }
}
