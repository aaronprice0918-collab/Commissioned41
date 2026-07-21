import { NextResponse } from "next/server";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";

// EILA maps the columns of an uploaded performance spreadsheet to a plan's metric
// keys, so any industry's export (a staffing agency's placements, a SaaS team's
// bookings) can feed the SAME engine. It only proposes a mapping — the human
// reviews it in the Pay Plan Studio before pay is computed. This mirrors the
// pay-plan parser: owner/admin-only, rate-limited, forced tool-use, no guessing
// (a column it can't place maps to null and is called out in notes).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Forced-tool-use model call to map spreadsheet columns; give it headroom past
// the default timeout so a wide sheet doesn't 504.
export const maxDuration = 60;
const MODEL = "claude-opus-4-8";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

async function resolveCaller(req: Request): Promise<{ ok: boolean }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: process.env.NODE_ENV !== "production" };
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false };
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return { ok: false };
  if (isOwnerEmail(data.user.email)) return { ok: true };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", data.user.id).maybeSingle();
  return { ok: normalizeAccessRole(profile?.role) === "Admin" };
}

const SYSTEM = `You map the COLUMNS of a performance spreadsheet to a compensation plan's METRIC KEYS, so a pay engine can read it. You are given the sheet's column headers, a few sample rows, and the plan's metrics (each { key, label, hint }). For every column decide its role:
- "metric": it corresponds to one of the plan's metric keys → set metricKey to that key.
- "name": it identifies the person/rep the row belongs to (name, employee, rep, agent…).
- "date": it's the date the row was earned/closed.
- "ignore": it doesn't map to anything the plan needs.
Match on MEANING, not exact spelling (e.g. "Gross", "Front Gross", "GP" → a frontGross/grossProfit metric; "Units"/"Cars"/"Deals"/"Placements" → a units metric). If a column plausibly matches no plan metric, use "ignore" and mention it in notes rather than forcing a match. Never invent a metricKey that isn't in the provided list. Keep every provided column in the output exactly once.`;

const TOOL = {
  name: "emit_mapping",
  description: "Return the column→metric mapping for the spreadsheet.",
  input_schema: {
    type: "object",
    properties: {
      mapping: {
        type: "array",
        description: "One entry per spreadsheet column, in the given order.",
        items: {
          type: "object",
          properties: {
            column: { type: "string", description: "The exact column header." },
            role: { type: "string", enum: ["metric", "name", "date", "ignore"] },
            metricKey: { type: "string", description: "The plan metric key when role is 'metric'; omit otherwise." },
          },
          required: ["column", "role"],
        },
      },
      notes: { type: "string", description: "Columns left unmapped or any assumption made." },
    },
    required: ["mapping"],
  },
} as const;

export async function POST(req: Request) {
  try {
    const { ok } = await resolveCaller(req);
    if (!ok) return NextResponse.json({ error: "Performance import is available to owners/admins only." }, { status: 403 });

    const rl = await rateLimit(clientKey(req), { limit: 20, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);

    const { headers, sample, metrics } = (await req.json()) as {
      headers?: string[];
      sample?: Record<string, unknown>[];
      metrics?: { key: string; label?: string; hint?: string }[];
    };
    if (!Array.isArray(headers) || headers.length === 0) return NextResponse.json({ error: "No spreadsheet columns to map." }, { status: 400 });
    if (!Array.isArray(metrics) || metrics.length === 0) return NextResponse.json({ error: "This plan defines no metrics to map to — author the plan first." }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Add ANTHROPIC_API_KEY to your Vercel environment and redeploy." }, { status: 500 });

    const promptText = [
      `Plan metrics:\n${metrics.map((m) => `- ${m.key}${m.label ? ` (${m.label})` : ""}${m.hint ? ` — ${m.hint}` : ""}`).join("\n")}`,
      `Spreadsheet columns:\n${headers.map((h) => `- ${h}`).join("\n")}`,
      `Sample rows (first ${Math.min(sample?.length ?? 0, 10)}):\n${JSON.stringify((sample ?? []).slice(0, 10))}`,
      `Map every column.`,
    ].join("\n\n");

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: [{ type: "text", text: promptText }] }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: `EILA couldn't map that (${res.status}). ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const json = await res.json();
    const toolUse = (json.content || []).find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse?.input) return NextResponse.json({ error: "EILA couldn't produce a mapping." }, { status: 422 });

    return NextResponse.json(toolUse.input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Performance mapping failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
