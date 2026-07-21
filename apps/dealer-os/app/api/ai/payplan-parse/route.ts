import { NextResponse } from "next/server";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";

// EILA reads ANY pay-plan document (PDF, phone photos, or pasted text) and emits
// a normalized CompPlan for lib/payEngine — the same shape every plan calculates
// from. The human reviews + confirms before it's saved (in the Pay Plan Studio);
// the model never silently invents structure — anything unclear goes in `notes`
// with a lower confidence so it's flagged for review, not guessed.
//
// Multi-page: real pay plans run several pages and phones capture one photo at
// a time, so `files[]` is a page list (photos and/or PDFs, in order) read as ONE
// document. Legacy single fileBase64/mediaType still accepted. (Ported from
// missionos-lite commit a2f776d after a field report.)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Multi-page plans (up to 10 photos) through vision run well past the platform
// default — the lite hotfix learned this live (multi-page vision runs 90s+).
export const maxDuration = 120;
const MODEL = "claude-opus-4-8";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// Page-list caps. The client compresses photos to ~300KB base64 each, so 10
// pages ride comfortably; the total keeps the legacy single-PDF allowance.
const MAX_FILES = 10;
const MAX_FILES_B64 = 14_000_000;
// Formats the vision API accepts — anything else would 400 the whole request,
// so unsupported pages are dropped here (the client already re-encodes to JPEG
// and warns; this is the backstop). The legacy single fileBase64/mediaType
// path stays unfiltered so older callers keep working unchanged.
const OK_MEDIA = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

// Pay plans are sensitive — owner/admin only.
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

const SYSTEM = `You are EILA, extracting a compensation plan — from ANY industry (auto dealership, staffing/recruiting, SaaS sales, real estate, insurance, home services, etc.) — into a normalized rules model that a calculation engine runs. Read the plan EXACTLY as written. Transcribe every number precisely — this is someone's paycheck. Do not invent, round, or "improve" anything. If something is ambiguous or you can't fully model it, still capture what you can and describe the gap in "notes", and lower "confidence".

The model is a list of rules. Rule kinds and their fields:
- "grid": a two-axis payout grid. { kind, base, x:{metric,tiers:[...]}, y:{metric,tiers:[...]}, cells:[[...]] } where cells[yIndex][xIndex] is the payout PERCENT. base is what the % multiplies: "netProfit" | "backGross" | "frontGross" | "totalGross" | "perUnit". tiers are ascending breakpoints.
- "flat": { kind, base, pct } — a flat percent of a base.
- "tier": { kind, metric, base?, tiers:[{min, pct?, flat?}] } — pick the highest tier whose min <= the metric (e.g. monthly units/placements/deals → a flat bonus or a rate). Use flat for dollar bonuses (volume/ladder bonuses), pct for a tiered rate.
- "bonus": { kind, id, label, when:{metric,op,value} (or an ARRAY of conditions meaning ALL must hold), addRatePct?, addFlat? } — op is one of > >= < <= ==. Adds to the rate or flat dollars when the condition holds.
- "penalty": { kind, id, label, when:{metric,op,value}, reduceGrossPct, consecutiveMetric?, addPctPerConsecutive? } — reduces gross pay by a percent when the condition holds; consecutive escalation optional.
- "deduction": { kind, id, label, perEventMetric, amountPerEvent } — flat dollars per counted event (chargebacks, clawbacks, returns, uncashed contracts).
- "perDeal": { kind, value, segmentBy?, segments?, default?, minFlat? } — commission paid PER item (deal/placement/policy). value = the per-item metric to band on (e.g. "cgp", "margin"); segments keyed by a category (e.g. vehicleClass, dealType); each segment is { bands:[{min,flat?,pct?}] } or { pct, highMin?, highPct?, minFlat? }.
- "draw": { kind, id, amount, per } — a recoverable draw/advance for ONE pay period; per is "cycle" or "month" (use "monthly" only for a legacy monthly figure).
- "trueup": { kind, id, label, note } — period-end reconciliation or any rule you understand but can't fully compute; put the detail in note.

Metric naming: invent clear camelCase metric keys for whatever the plan measures (e.g. units, placements, margin, arr, grossProfit, attachRate, csat) and DEFINE EACH in vocab.metrics (below). For automotive plans reuse the established keys: pvr, ppu, units, backGross, frontGross, netProfit, vscPenetration (0-100), menuUsage (0-100), csiBelow, csiMonthsBelow, uncashedContracts.

ALSO extract:
- "cycle": how/when the plan pays. { mode: "calendarMonth"|"fixedLength"|"semiMonthly"|"quarterly"|"custom", lengthDays? (7=weekly,14=biweekly), semiMonthlyDays? [1,16], anchor? "YYYY-MM-DD", payOffsetDays? (check issued N days after the period closes) OR payDayOfNextPeriod? (paid on the Nth day of the next period), periodNoun? }. If the plan doesn't state a schedule, use { mode: "calendarMonth" } and note it.
- "vocab": the plan's language. { currency (ISO 4217, default USD), locale?, unitNoun (what one sale is called: "unit"/"deal"/"placement"/"policy"/"job"), periodNoun, metrics: [{ key, label, format: "money"|"number"|"percent"|"ratio", hint? }] } — one entry PER metric key you used, so the app can label and format it for this industry.

Classify planType as flat | tiered | grid | hybrid (a grid/flat/tier/perDeal base PLUS other base kinds) | unsupported (no calculable base rule found). Set confidence high/medium/low. Put anything you couldn't fully model, or any assumption you made, into notes.`;

const TOOL = {
  name: "emit_comp_plan",
  description: "Return the extracted compensation plan as a normalized CompPlan.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Plan name, e.g. 'F&I Manager — Kennesaw Mazda'." },
      role: { type: "string", description: "Role the plan pays: Sales, F&I, Manager, BDC, Desk, etc." },
      effectiveDate: { type: "string", description: "Effective date if stated (YYYY-MM-DD)." },
      sourceDoc: { type: "string", description: "A short reference to the source document." },
      planType: { type: "string", enum: ["flat", "tiered", "grid", "hybrid", "unsupported"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      rules: {
        type: "array",
        description: "The normalized rules. Each has a `kind` plus that kind's fields.",
        items: { type: "object", properties: { kind: { type: "string", enum: ["grid", "flat", "tier", "perDeal", "bonus", "penalty", "deduction", "draw", "trueup"] } }, required: ["kind"], additionalProperties: true },
      },
      cycle: {
        type: "object",
        description: "How/when the plan pays (pay cycle + earned-vs-paid timing).",
        properties: {
          mode: { type: "string", enum: ["calendarMonth", "fixedLength", "semiMonthly", "quarterly", "custom"] },
          lengthDays: { type: "number", description: "fixedLength: 7=weekly, 14=biweekly, etc." },
          semiMonthlyDays: { type: "array", items: { type: "number" }, description: "semiMonthly: the two period-start days, e.g. [1,16]." },
          anchor: { type: "string", description: "A known period-start date, YYYY-MM-DD." },
          payOffsetDays: { type: "number", description: "Check issued this many days after a period closes." },
          payDayOfNextPeriod: { type: "number", description: "…or paid on the Nth day of the following period." },
          periodNoun: { type: "string" },
        },
      },
      vocab: {
        type: "object",
        description: "The plan's language: currency, unit noun, and a label/format for every metric key used.",
        properties: {
          currency: { type: "string", description: "ISO 4217, default USD." },
          locale: { type: "string" },
          unitNoun: { type: "string", description: "What one sale is called: unit/deal/placement/policy/job." },
          periodNoun: { type: "string" },
          metrics: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                label: { type: "string" },
                format: { type: "string", enum: ["money", "number", "percent", "ratio"] },
                hint: { type: "string" },
              },
              required: ["key", "label"],
            },
          },
        },
      },
      notes: { type: "string", description: "Anything ambiguous, assumed, or not fully modeled — flagged for human review." },
      summary: { type: "string", description: "One-line plain-English summary of the plan." },
    },
    required: ["name", "planType", "confidence", "rules"],
  },
} as const;

export async function POST(req: Request) {
  try {
    const { ok } = await resolveCaller(req);
    if (!ok) return NextResponse.json({ error: "Pay-plan parsing is available to owners/admins only." }, { status: 403 });

    const rl = await rateLimit(clientKey(req), { limit: 10, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);

    const body = (await req.json()) as { text?: string; fileBase64?: string; mediaType?: string; files?: { dataB64?: string; mediaType?: string }[] };
    const text = body.text;
    // Normalize to a page list; the legacy single fileBase64/mediaType becomes a one-page list.
    let files: { dataB64: string; mediaType: string }[] = [];
    if (Array.isArray(body.files)) files = body.files.filter((f): f is { dataB64: string; mediaType: string } => !!f?.dataB64 && OK_MEDIA.has(f?.mediaType ?? "")).slice(0, MAX_FILES);
    else if (body.fileBase64 && body.mediaType) files = [{ dataB64: body.fileBase64, mediaType: body.mediaType }];
    const hasText = !!text && text.trim().length > 0;
    if (!hasText && !files.length) return NextResponse.json({ error: "Paste the pay plan, or upload its pages (PDF or photos) first." }, { status: 400 });
    if (text && text.length > 400_000) return NextResponse.json({ error: "That's too large to parse at once." }, { status: 413 });
    if (files.reduce((n, f) => n + f.dataB64.length, 0) > MAX_FILES_B64) return NextResponse.json({ error: "That's too much at once — remove a page or two and try again." }, { status: 413 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Add ANTHROPIC_API_KEY to your Vercel environment and redeploy." }, { status: 500 });

    const content: any[] = [];
    files.forEach((f, i) => {
      if (files.length > 1) content.push({ type: "text", text: `Page ${i + 1} of ${files.length}:` });
      if (f.mediaType.startsWith("image/")) content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.dataB64 } });
      else content.push({
        type: "document",
        source: f.mediaType === "application/pdf" ? { type: "base64", media_type: "application/pdf", data: f.dataB64 } : { type: "text", media_type: "text/plain", data: f.dataB64 },
      });
    });
    const pagesNote = files.length > 1 ? ` The plan spans ${files.length} pages/files — read them ALL as ONE document before extracting.` : "";
    content.push({ type: "text", text: hasText ? `Extract this pay plan:${pagesNote}\n\n${text}` : `Extract the attached pay plan.${pagesNote}` });

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: `EILA couldn't read that (${res.status}). ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const json = await res.json();
    const toolUse = (json.content || []).find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse?.input) return NextResponse.json({ error: "EILA couldn't find a pay plan to extract." }, { status: 422 });

    return NextResponse.json({ plan: toolUse.input });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pay-plan parse failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
