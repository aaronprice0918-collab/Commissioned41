import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";

// EILA reads a photo of an auto-insurance card with vision and returns the
// coverage details as structured fields — carrier, policy number, agent and the
// effective dates — straight into the deal. Same Anthropic API the app uses for
// the license read; costs a fraction of a cent per scan.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const PROMPT = `You are reading a photo of a US auto-insurance ID card. Extract the policy details.

Respond with ONLY a JSON object — no prose, no code fences — with exactly these keys:
{
  "insuranceCompany": "",
  "insurancePolicy": "",
  "insuranceAgentName": "",
  "insuranceAgentPhone": "",
  "insuranceAgentAddress": "",
  "insuranceEffectiveFrom": "",
  "insuranceEffectiveTo": ""
}

Rules:
- insuranceCompany = the insurer / carrier name (e.g. "State Farm", "GEICO", "Progressive").
- insurancePolicy = the policy number exactly as printed.
- insuranceAgentName / Phone / Address = the agent or local office, if shown; otherwise "".
- insuranceEffectiveFrom = the policy effective / start date as YYYY-MM-DD.
- insuranceEffectiveTo = the policy expiration / end date as YYYY-MM-DD.
- Proper Title Case for names and addresses, not ALL CAPS.
- If a field isn't clearly visible, use "".
- If the image is not an insurance card, respond with {"error":"not an insurance card"}.`;

function extractJson(text: string): Record<string, string> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    // Auth-gate: only signed-in users can spend the vision quota / send images.
    // Fail CLOSED in production — refuse if the server client can't be built.
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    } else {
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const { data } = token ? await supabase.auth.getUser(token) : { data: { user: null } };
      if (!data?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimit(clientKey(req), { limit: 20, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Add ANTHROPIC_API_KEY to your Vercel environment and redeploy." }, { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as { image?: string };
    const image = body.image || "";
    const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "No usable image was sent." }, { status: 400 });
    }
    const mediaType = match[1];
    const data = match[2];

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "EILA couldn't read that one — retake it sharp and well-lit." }, { status: 502 });
    }

    const out = await res.json();
    const textBlock = Array.isArray(out?.content) ? out.content.find((c: { type?: string }) => c?.type === "text") : null;
    const fields = extractJson(textBlock?.text || "");
    if (!fields || (fields as { error?: string }).error) {
      return NextResponse.json({ error: "That didn't look like an insurance card. Capture the front — flat, well-lit, filling the frame." }, { status: 422 });
    }

    const keys = ["insuranceCompany", "insurancePolicy", "insuranceAgentName", "insuranceAgentPhone", "insuranceAgentAddress", "insuranceEffectiveFrom", "insuranceEffectiveTo"];
    const clean: Record<string, string> = {};
    for (const k of keys) clean[k] = String(fields[k] ?? "").trim();

    return NextResponse.json({ fields: clean });
  } catch {
    return NextResponse.json({ error: "Something went wrong reading the card — try again." }, { status: 500 });
  }
}
