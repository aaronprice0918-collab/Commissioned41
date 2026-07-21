import { NextResponse } from "next/server";
import { makePlan } from "@/lib/payplan/plans";
import { DealSegment, PayPlan, PerDealRule } from "@/lib/payplan/types";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { rateLimited } from "@/lib/rateLimit";

// Universal pay-plan parser: reads any pay plan (flat, tiered, grid, hybrid) and
// returns a normalized PayPlan. Uses Claude when ANTHROPIC_API_KEY is set;
// otherwise returns { ok:false } so the client falls back to a role default.
// Never silently empty — an unreadable doc returns a clear reason.
//
// Gated: this endpoint spends the Anthropic key, so it requires a signed-in,
// subscribed caller and is throttled + size-capped to prevent abuse.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Multi-page plans (up to 10 photos) through vision run well past the platform
// default — same reason scan-statement sets 300 (July 5: "six PDFs through
// vision can exceed 90s").
export const maxDuration = 120;

const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL; // any Vercel deploy (previews too) enforces the gate — only true local dev gets the convenience pass
const MODEL = "claude-opus-4-8";

// Shared-store throttle (lib/rateLimit.ts): max 8 requests per 60s, enforced
// across all serverless instances, not just per cold-start.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;

// Cap on the raw text/base64 content we'll accept. Pay plans arrive as a
// STACK of phone photos (client compresses each to ~300KB base64), so the
// cap covers a multi-page plan while staying under the platform body limit.
const MAX_CONTENT_BYTES = 4_200_000;
const MAX_FILES = 10;

const SCHEMA = `Output ONLY a JSON object describing the pay plan (plain numbers, no $ or %):
{
  "type": "flat" | "tiered" | "grid" | "perDeal" | "hybrid",
  "effectiveDate": "YYYY-MM-DD" | null,
  "base": { "salary": n, "frontPct": n, "backPct": n, "perUnit": n, "perProduct": n, "basis": "back"|"front"|"total" },
  "grid": null | { "x": [PVR thresholds asc], "y": [product-per-unit thresholds asc], "rates": [[percent per y-row × x-col]], "basis": "back" },
  "perDeal": null | { "segments": { "<deal category, lowercase: new|used|lease|...>": { "bands": [ { "min": n, "flat": n } | { "min": n, "pct": n } ] | null, "pct": n, "highMin": n, "highPct": n, "minFlat": n } }, "default": { "minFlat": n }, "minFlat": n },
  "tiers": [ { "label": s, "metric": "units"|"totalGross"|"backGross"|"frontGross", "threshold": n, "kind": "flat"|"pct", "amount": n } ],
  "bonuses": [ { "label": s, "condition": { "metric": "pvr"|"backPvr"|"vscPenetration"|"units"|"fastStartUnits"|"products"|"totalGross", "op": "gt"|"gte"|"lt"|"lte"|"eq", "value": n } | [conditions…], "effect": { "kind": "addRatePct"|"pctOfBasis"|"flat", "amount": n, "basis": "back" } } ],
  "penalties": [ { "label": s, "condition": { "metric": "menuUsage"|"csiBelowRegion"|"chargebacks", "op": "lt"|"gte", "value": n }, "reduceGrossPct": n, "consecutiveMetric": "csiConsecutiveBelow"|null, "consecutiveAdditionalPct": n } ],
  "deductions": [ { "label": s, "kind": "perOccurrence"|"flat"|"pctOfGrossPay", "amount": n, "metric": "contractsNotCashed"|null } ],
  "draw": null | { "amount": n, "period": "monthly"|"semimonthly", "recoverable": true },
  "trueUp": null | { "description": s },
  "guaranteeFloor": n,
  "goalUnits": n,
  "unsupported": [ "any rule you could NOT map — describe it briefly" ],
  "confidence": 0..1
}
Rules:
- If the plan pays EACH SALE on its own gross ("$400 per new car with $1+ gross, $250 down to −$300, $150 below that"; "used: 25% of gross, 30% at $3,000+, $150 mini") → that is a "perDeal" plan. Put it in "perDeal" with segments keyed by the deal category (lowercase "new"/"used"/"lease"), bands = highest matching "min" wins, "minFlat" = the per-deal minimum ("mini"). Set frontPct to 0 — NEVER flatten per-deal pay into a monthly percentage (a loser deal must pay the mini, not subtract from the month). A monthly volume ladder on top stays in "tiers".
- F&I plans usually pay a RATE from a PVR × product-per-unit GRID applied to back-end (net F&I) profit — capture it in "grid" and set base percentages to 0.
- "PVR $X or higher adds Y% to the grid" / "$X PVR qualifies" → a bonus with effect addRatePct on metric pvr with op "gte". "VSC penetration 50% or higher adds 0.5%" → bonus addRatePct on metric vscPenetration with op "gte".
- Menu/CSI penalties → penalties. Contracts-not-cashed fines → a perOccurrence deduction on metric contractsNotCashed.
- A bonus gated on MULTIPLE requirements ("$500 with 10+ units AND back PVR ≥ $1,300") → ONE bonus whose "condition" is an ARRAY of all the conditions (never two separate bonuses, never drop a leg). Back-end PVR → metric "backPvr". "N units delivered by the 15th" → metric "fastStartUnits" (the app counts them from deal dates).
- "guaranteeFloor" is a MONTHLY dollar minimum only. An HOURLY guarantee ($15/hr etc.) does NOT go there — describe it in "unsupported".
- Draw → draw. Month-end true-up / chargeback language → trueUp.description.
- Put anything you cannot represent into "unsupported" — never drop it silently.
- Be faithful to the document; never invent numbers. Use 0/[]/null when absent.`;

interface FilePayload { dataB64: string; mediaType: string }

// Formats the vision API accepts — anything else would 400 the whole request,
// so unsupported pages are dropped here (the client already re-encodes to JPEG
// and warns; this is the backstop for older/direct clients).
const OK_MEDIA = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

function withIds<T extends { id?: string }>(arr: T[] | undefined, prefix: string): (T & { id: string })[] {
  return (arr || []).map((x, i) => ({ ...x, id: x.id || `${prefix}${i}` }));
}

function normalizeParsedBonuses(arr: any[] | undefined): any[] {
  return (arr || []).map((b) => {
    const normalize = (c: any) =>
      c?.metric === "pvr" && c?.op === "gt" && Number(c?.value) === 1900 && b?.effect?.kind === "addRatePct" && Number(b?.effect?.amount) === 0.5
        ? { ...c, op: "gte" }
        : c;
    return {
      ...b,
      label: typeof b?.label === "string" ? b.label.replace(/PVR over \$1,?900/i, "PVR $1,900+") : b?.label,
      condition: Array.isArray(b?.condition) ? b.condition.map(normalize) : normalize(b?.condition),
    };
  });
}

// Model output → a clean PerDealRule (numbers coerced, junk dropped, category
// keys lowercased so they match the app's deal categories). undefined if empty.
function sanitizePerDeal(raw: unknown): PerDealRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
  const seg = (s: unknown): DealSegment | undefined => {
    if (!s || typeof s !== "object") return undefined;
    const o = s as Record<string, unknown>;
    const bands = Array.isArray(o.bands)
      ? o.bands
          .map((b) => {
            const bb = b as Record<string, unknown>;
            const min = num(bb?.min);
            if (min === undefined) return null;
            return { min, ...(num(bb.flat) !== undefined ? { flat: num(bb.flat) } : {}), ...(num(bb.pct) !== undefined ? { pct: num(bb.pct) } : {}) };
          })
          .filter((b): b is NonNullable<typeof b> => !!b && (b.flat !== undefined || b.pct !== undefined))
      : undefined;
    const out: DealSegment = {
      ...(bands?.length ? { bands } : {}),
      ...(num(o.pct) !== undefined ? { pct: num(o.pct) } : {}),
      ...(num(o.highMin) !== undefined ? { highMin: num(o.highMin) } : {}),
      ...(num(o.highPct) !== undefined ? { highPct: num(o.highPct) } : {}),
      ...(num(o.minFlat) !== undefined ? { minFlat: num(o.minFlat) } : {}),
    };
    return Object.keys(out).length ? out : undefined;
  };
  const segments: Record<string, DealSegment> = {};
  if (r.segments && typeof r.segments === "object") {
    for (const [k, v] of Object.entries(r.segments as Record<string, unknown>)) {
      const s = seg(v);
      if (s) segments[k.toLowerCase().trim()] = s;
    }
  }
  const out: PerDealRule = {
    ...(Object.keys(segments).length ? { segments } : {}),
    ...(seg(r.default) ? { default: seg(r.default) } : {}),
    ...(num(r.minFlat) !== undefined ? { minFlat: num(r.minFlat) } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

export async function POST(req: Request) {
  // --- Auth gate (before reading the body or spending the Anthropic key) ---
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  // Throttle per email regardless of subscription state.
  if (await rateLimited(`parse-payplan:${email}`, RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  // Require an active subscription. In dev, allow through so local work isn't blocked.
  let active = false;
  try {
    active = await hasActiveSubscription(email);
  } catch (e) {
    console.error("[parse-payplan] subscription check failed:", e);
    active = false;
  }
  if (!active && IS_PROD) {
    return NextResponse.json({ error: "Subscription required." }, { status: 402 });
  }

  let role = "sales";
  let industry = "automotive";
  let text = "";
  let files: FilePayload[] = [];
  try {
    const body = await req.json();
    // Allow-list role/industry — they're interpolated into the Anthropic
    // prompt, so free-form strings were a prompt-injection surface (July 8
    // audit). Unknown values fall back to safe defaults.
    const ROLES = new Set(["sales", "finance", "sales_manager", "bdc"]);
    const INDUSTRIES = new Set(["automotive", "rv_boats_powersports", "real_estate", "mortgage", "insurance", "furniture", "jewelry", "solar_roofing", "recruiting", "saas", "financial_services", "other"]);
    role = ROLES.has(String(body?.role)) ? String(body.role) : "sales";
    industry = INDUSTRIES.has(String(body?.industry)) ? String(body.industry) : "automotive";
    text = String(body?.text ?? "");
    // Multi-page: `files` is the page list (photos and/or PDFs, in order).
    // Legacy single `file` still accepted from older clients.
    if (Array.isArray(body?.files)) {
      files = body.files.filter((f: any) => f?.dataB64 && OK_MEDIA.has(f?.mediaType)).slice(0, MAX_FILES);
    } else if (body?.file?.dataB64 && OK_MEDIA.has(body?.file?.mediaType)) {
      files = [body.file as FilePayload];
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Cap the payload: reject oversized text/base64 content.
  const contentLen = text.length + files.reduce((n, f) => n + f.dataB64.length, 0);
  if (contentLen > MAX_CONTENT_BYTES) {
    return NextResponse.json({ error: "File too large — remove a page or two and try again." }, { status: 413 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || (!text.trim() && !files.length)) return NextResponse.json({ ok: false, reason: key ? "no_input" : "no_key" });

  const blocks: any[] = [];
  files.forEach((file, i) => {
    if (files.length > 1) blocks.push({ type: "text", text: `Page ${i + 1} of ${files.length}:` });
    if (file.mediaType === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.dataB64 } });
    else if (file.mediaType.startsWith("image/")) blocks.push({ type: "image", source: { type: "base64", media_type: file.mediaType, data: file.dataB64 } });
  });
  // Text pages can arrive ALONGSIDE photo/PDF pages (e.g. page 1 as .txt,
  // pages 2-3 as photos) — they are part of the same document, never dropped.
  if (files.length && text.trim()) blocks.push({ type: "text", text: `Additional page(s) of the same plan, as text:\n\n${text.slice(0, 120000)}` });
  const pagesNote = files.length > 1 ? ` The plan spans ${files.length} pages/files — read them ALL as ONE document before extracting.` : "";
  blocks.push({ type: "text", text: files.length ? `This is a ${role}'s pay plan in the ${industry} industry.${pagesNote} Extract it. ${SCHEMA}` : `Pay plan for a ${role} in the ${industry} industry:\n\n${text.slice(0, 120000)}\n\n${SCHEMA}` });

  // Industry-aware guidance: the normalized JSON is universal (two channels +
  // rules), but WHAT the primary channel means differs by vertical.
  const industryGuidance =
    industry === "automotive" || industry === "rv_boats_powersports"
      ? "This is a dealership-world plan: frontPct applies to front-end gross, backPct to back-end (F&I) gross, and F&I grid plans go in \"grid\"."
      : `This is a ${industry.replace(/_/g, " ")} plan — there is only ONE money channel: map the rep's commission percentage (or bps, converted to a percent) onto frontPct with basis "front", and leave backPct, perProduct, and grid at 0/null. The percentage applies to the plan's commissionable amount (sale price, gross commission, premium, fee, or contract value — whatever the document says). CRITICAL — tiers are ADDITIVE bonuses on top of the base, so: (1) NEVER duplicate the base percentage as a tier (no threshold-0 pct tier repeating frontPct — that double-pays); (2) a sliding scale where the rate RISES at a volume threshold becomes a tier whose pct amount is the INCREASE ONLY (new% minus base%), labeled with the real new rate (e.g. "Split rises to 85% (+15%)"), AND note in unsupported whether it applies retroactively or only going forward if the document doesn't say.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: `You are a compensation analyst who has seen pay plans from every commission industry. Convert this ${industry.replace(/_/g, " ")} pay plan into the normalized JSON below for a ${role}. ${industryGuidance} Classify the structure and never silently drop a rule.`, messages: [{ role: "user", content: blocks }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const json = await res.json();
    const raw = json?.content?.find((c: any) => c.type === "text")?.text ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no json");
    const p = JSON.parse(match[0]);

    const plan: PayPlan = makePlan({
      role,
      effectiveDate: p.effectiveDate || undefined,
      base: p.base || undefined,
      grid: p.grid && Array.isArray(p.grid.rates) && p.grid.rates.length ? { xAxis: "pvr", x: p.grid.x, yAxis: "ppt", y: p.grid.y, rates: p.grid.rates, basis: p.grid.basis || "back" } : undefined,
      perDeal: sanitizePerDeal(p.perDeal),
      tiers: withIds(p.tiers, "t"),
      bonuses: withIds(normalizeParsedBonuses(p.bonuses), "b"),
      penalties: withIds(p.penalties, "p"),
      deductions: withIds(p.deductions, "d"),
      draw: p.draw && p.draw.amount ? p.draw : undefined,
      trueUp: p.trueUp && p.trueUp.description ? p.trueUp : undefined,
      guaranteeFloor: p.guaranteeFloor || undefined,
      goalUnits: p.goalUnits || 0,
      unsupported: Array.isArray(p.unsupported) ? p.unsupported : [],
      confidence: typeof p.confidence === "number" ? p.confidence : 0.6,
    });

    const meaningful = !!plan.grid || !!plan.perDeal || plan.base.frontPct || plan.base.backPct || plan.base.perUnit || plan.base.perProduct || plan.base.salary || plan.tiers.length || plan.bonuses.length;
    if (!meaningful && plan.unsupported.length === 0) return NextResponse.json({ ok: false, reason: "empty" });
    return NextResponse.json({ ok: true, plan });
  } catch (err) {
    console.error("[parse-payplan]", err);
    return NextResponse.json({ ok: false, reason: "parse_failed" });
  }
}
