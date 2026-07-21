import { NextResponse } from "next/server";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { rateLimited } from "@/lib/rateLimit";

// The daily-ritual shortcut: snap a screenshot of the bank app and EILA reads
// the balance off it — no typing. One prominent number off one image, so it
// runs on the fast model; the user CONFIRMS before anything saves (money is
// sacred, the approve gate stays). Screenshot is read and discarded — never
// stored. Same gate/throttle posture as scan-statement, tighter limits.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001"; // one number off one screenshot + a human confirm gate — the fast model earns its keep at daily volume

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const MAX_FILE_BYTES = 6_000_000;

const PROMPT = `You are reading ONE screenshot of a person's banking app or bank website. Extract their CHECKING account balance.

Respond with ONLY a JSON object — no prose, no code fences:
{ "balance": 0, "accountName": "", "kind": "available" }

Rules:
- Prefer the AVAILABLE balance over the current/ledger balance when both show.
- If several accounts are visible, pick the checking/spending account (not savings, not a credit card). accountName = the bank or account label you used ("Chase Total Checking", "Navy Federal").
- kind = "available" | "current" | "unknown" — which balance you read.
- balance is a positive number, no $ or commas, cents allowed.
- Be faithful to the screen; never invent or guess digits you can't read clearly.
- If the image is NOT a banking screen or no balance is readable, respond with {"error":"no balance visible"}.`;

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
    if (await rateLimited(`scan-balance:${email}`, RATE_WINDOW_MS, RATE_MAX)) {
      return NextResponse.json({ error: "Too many scans. Try again shortly." }, { status: 429 });
    }

    let active = false;
    try { active = await hasActiveSubscription(email); } catch { active = false; }
    if (!active && IS_PROD) return NextResponse.json({ error: "Subscription required." }, { status: 402 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "The balance reader isn't configured." }, { status: 503 });

    const body = (await req.json().catch(() => ({}))) as { file?: { dataB64?: string; mediaType?: string } };
    const data = String(body.file?.dataB64 || "");
    const mediaType = String(body.file?.mediaType || "");
    if (!data) return NextResponse.json({ error: "No screenshot was sent." }, { status: 400 });
    if (data.length > MAX_FILE_BYTES) return NextResponse.json({ error: "That image is too large — a plain screenshot works best." }, { status: 413 });
    if (!/^image\/(jpeg|png|webp)$/.test(mediaType)) {
      return NextResponse.json({ error: "Send a screenshot image (a photo of the screen works too)." }, { status: 400 });
    }

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data } },
          { type: "text", text: PROMPT },
        ] }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: "EILA couldn't read that one — try a cleaner screenshot." }, { status: 502 });

    const out = await res.json();
    const textBlock = Array.isArray(out?.content) ? out.content.find((c: { type?: string }) => c?.type === "text") : null;
    const fields = extractJson(textBlock?.text || "");
    if (!fields || (fields as { error?: string }).error || typeof fields.balance !== "number" || !isFinite(fields.balance as number)) {
      return NextResponse.json({ error: "No balance visible there — screenshot the account screen that shows your available balance." }, { status: 422 });
    }

    const balance = Math.round(Math.abs(fields.balance as number));
    const accountName = String(fields.accountName ?? "").trim().slice(0, 60);
    const kind = ["available", "current", "unknown"].includes(String(fields.kind)) ? String(fields.kind) : "unknown";
    return NextResponse.json({ balance, accountName, kind });
  } catch (e) {
    console.error("[scan-balance]", e);
    return NextResponse.json({ error: "Something went wrong reading the screenshot — try again." }, { status: 500 });
  }
}
