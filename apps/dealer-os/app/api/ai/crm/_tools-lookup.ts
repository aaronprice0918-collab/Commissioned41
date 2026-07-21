import type { EILAContext } from "./_context";
import { scopeLeads } from "./_context";
import { currency, samePerson } from "@/lib/data";
import { personLabel } from "@/lib/desk";
import { decodeVin, isValidVin } from "@/lib/vin";
import { speedClock, speedStats } from "@/lib/speedToLead";
import { consentStatus, consentSummary, suppressionDeadline } from "@/lib/consent";

const num = (v: any) => (Number.isFinite(+v) ? +v : 0);

// lookup_rate — quote an exact BUY rate off the loaded lender rate sheet, by
// lender / tier / term / model-year. Rate sheets fan out by year×term×tier, so
// they're the most-capped part of the snapshot; this pulls the precise line.
export function handleLookupRate(input: any, ctx: EILAContext): string {
  const setup = ctx.data.monthlySetup;
  const lenders: any[] = Array.isArray(setup?.rateSheets?.lenders) ? setup.rateSheets.lenders : [];
  if (!lenders.length) return "No lender rate sheet is loaded for this store. Add one in Monthly Setup, then I can quote exact buy rates.";

  const qLender = String(input?.lender || "").trim().toLowerCase();
  const qTier = String(input?.tier || "").trim().toLowerCase();
  const qTerm = num(input?.termMonths);
  const qYear = String(input?.year || "").trim().toLowerCase();
  const has = (hay: any, needle: string) => String(hay || "").toLowerCase().includes(needle);

  const rows: string[] = [];
  for (const l of lenders) {
    if (qLender && !has(l.lender, qLender)) continue;
    for (const t of Array.isArray(l.tiers) ? l.tiers : []) {
      if (qTier && !has(t.tier, qTier)) continue;
      for (const r of Array.isArray(t.rates) ? t.rates : []) {
        if (qTerm && num(r.termMonths) !== qTerm) continue;
        if (qYear && !has(r.year, qYear)) continue;
        const adv = r.maxAdvancePct ? ` (≤${r.maxAdvancePct}% adv)` : "";
        const minAmt = r.minAmountFinanced ? ` (min $${r.minAmountFinanced})` : "";
        rows.push(`  ${l.lender} · ${t.tier} · ${r.year ? r.year + " · " : ""}${num(r.termMonths)}mo · ${(+r.buyRate).toFixed(2)}% buy${adv}${minAmt}`);
      }
    }
  }

  if (!rows.length) {
    const avail = lenders.map((l: any) => `${l.lender} [${(Array.isArray(l.tiers) ? l.tiers : []).map((t: any) => t.tier).join(", ")}]`).join("; ");
    return `No rate matches that exactly. Loaded lenders/tiers: ${avail || "none"}. Reserve = sell rate − buy rate within the lender's cap.`;
  }

  const eff = setup?.rateSheets?.effectiveMonth ? ` (effective ${setup.rateSheets.effectiveMonth})` : "";
  const capped = rows.length > 80 ? rows.slice(0, 80).concat([`  …and ${rows.length - 80} more — narrow by lender/tier/term/year.`]) : rows;
  return `BUY rates${eff} — reserve = sell − buy within the lender's cap:\n${capped.join("\n")}`;
}

// decode_vin — the same NHTSA decoder the Deal Entry and CRM Desk screens use
// (lib/vin.ts), plus a cross-check against this store's deals and leads so a
// VIN question lands on the actual record when there is one.
export async function handleDecodeVin(input: any, ctx: EILAContext): Promise<string> {
  const raw = String(input?.vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 17 || !isValidVin(raw)) {
    return `"${raw || input?.vin || ""}" isn't a valid 17-character VIN (no I, O, or Q). Double-check it and give me the full VIN.`;
  }
  const decoded = await decodeVin(raw);
  const L: string[] = [];
  if (decoded) {
    L.push(`VIN ${raw} decodes to: ${decoded.vehicle}${decoded.body ? ` · ${decoded.body}` : ""}${decoded.cylinders ? ` · ${decoded.cylinders}cyl` : ""}${decoded.fuel ? ` · ${decoded.fuel}` : ""}.`);
  } else {
    L.push(`VIN ${raw} is well-formed but NHTSA couldn't decode it — it may be mistyped or very new. Cross-checking the store's records anyway:`);
  }

  const { viewer } = ctx;
  const dealsRedact = viewer.role === "Sales" || viewer.role === "BDC";
  const owns = (d: any) => samePerson(d.salesperson, viewer.employeeName) || samePerson(d.salesperson2, viewer.employeeName);
  const deals: any[] = Array.isArray(ctx.data.deals) ? ctx.data.deals : [];
  const dealHits = deals.filter((d) => String(d.vin || "").toUpperCase() === raw || String(d.tradeVin || "").toUpperCase() === raw);
  for (const d of dealHits) {
    const who = dealsRedact && !owns(d) ? "[hidden]" : (d.customer || "?");
    const as = String(d.tradeVin || "").toUpperCase() === raw ? "the TRADE on" : "the sold unit on";
    L.push(`It's ${as} this month's deal: ${who} · stock ${d.stockNumber || "?"} · ${d.stage || "?"} · ${personLabel(d.salesperson)}.`);
  }
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], viewer);
  const leadHits = leads.filter((l: any) => String(l.vin || "").toUpperCase() === raw);
  for (const l of leadHits) L.push(`It's on the floor: ${l.customer || "?"} · ${l.vehicle || "TBD"} · ${l.status} · ${personLabel(l.salesperson)}.`);
  if (!dealHits.length && !leadHits.length) L.push("No deal or working lead in this store carries that VIN.");
  return L.join("\n");
}

// speed_to_lead — the Five-Minute Response System (lib/speedToLead.ts, the
// same brain as the CRM Desk card). Live clocks + the 30-day grade, scoped
// like every lead read: reps see their own book, managers the store.
export function handleSpeedToLead(_input: any, ctx: EILAContext): string {
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer);
  const stats = speedStats(leads as any[]);
  const L: string[] = [];
  const live = (leads as any[])
    .map((l) => ({ l, clock: speedClock(l) }))
    .filter(({ clock }) => clock.state === "on_clock" || clock.state === "breached");
  if (live.length) {
    L.push(`=== RIGHT NOW: ${stats.onClockNow} on the 5:00 clock · ${stats.breachedNow} OVER it ===`);
    for (const { l, clock } of live) {
      const t = clock.state === "on_clock" ? `${Math.floor((clock as any).secondsLeft / 60)}:${String((clock as any).secondsLeft % 60).padStart(2, "0")} left` : `${(clock as any).minutesOver} min OVER`;
      L.push(`${l.customer || "?"} · ${l.vehicle || "TBD"} · ${personLabel(l.salesperson)} · ${t}${l.customerPhone ? ` · ${l.customerPhone}` : ""}`);
    }
    L.push("A fresh up answered inside five minutes converts — get these called FIRST, then everything else.");
  } else {
    L.push("Nobody is on the 5-minute clock right now — every fresh up has been contacted.");
  }
  L.push(`\n30-DAY GRADE: ${stats.under5Pct}% answered under 5:00 (${stats.measured} graded) · avg ${stats.avgMinutes ?? "—"} min · median ${stats.medianMinutes ?? "—"} min.`);
  if (stats.byRep.length > 1) {
    L.push("By rep:");
    for (const r of stats.byRep) L.push(`  ${personLabel(r.name)}: ${r.under5Pct}% under 5 (${r.measured} graded, avg ${r.avgMinutes ?? "—"}m)`);
  }
  return L.join("\n");
}

// check_consent — the TCPA rail (lib/consent.ts, same brain as the chips on
// the lead card). ALWAYS check before drafting outreach: a revoked channel is
// a hard no ($500–$1,500 statutory damages per text/call), and the audit
// trail here is the store's defense. Scoped like every lead read.
export function handleCheckConsent(input: any, ctx: EILAContext): string {
  const q = String(input?.customer || "").trim().toLowerCase();
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer) as any[];
  const hits = q
    ? leads.filter((l) => String(l.customer || "").toLowerCase().includes(q))
    : leads.filter((l) => consentSummary(l).revokedAny);
  if (!hits.length) return q ? `No working lead matches "${input?.customer}".` : "No lead in this store has a revoked channel — nothing is suppressed.";
  const L: string[] = [];
  for (const l of hits.slice(0, 10)) {
    const s = consentSummary(l);
    L.push(`${l.customer || "?"} (${l.status}) — call: ${s.call} · text: ${s.text} · email: ${s.email}`);
    const events = l.consent?.events ?? [];
    for (const e of events.slice(-5)) {
      L.push(`  ${e.action.toUpperCase()} ${e.channel} · ${new Date(e.at).toLocaleDateString()} · ${e.source}${e.by ? ` · recorded by ${e.by}` : ""}`);
      if (e.action === "revoked") L.push(`    (suppressed immediately; legal deadline ${new Date(suppressionDeadline(e.at)).toLocaleDateString()})`);
    }
    if (!events.length) L.push("  No consent recorded — a human may reach out normally, but capture consent before any automated/text outreach.");
    if (s.revokedAny) L.push("  ⚠️ DO NOT contact on the revoked channel(s). No drafts, no workarounds.");
  }
  return L.join("\n");
}

export const LOOKUP_RATE_TOOL = {
  name: "lookup_rate",
  description:
    "Quote an exact BUY rate off this store's loaded lender rate sheet, narrowed by lender, credit tier, term, and/or vehicle model-year. Rate sheets fan out by year × term × tier, so the summary can't always show the exact line — use this whenever someone needs a precise rate ('LGE buy rate for a 2024 at 740 for 66 months', 'cheapest 72mo Tier 1 rate'). Reserve = sell rate − buy rate within the lender's cap.",
  input_schema: {
    type: "object",
    properties: {
      lender: { type: "string", description: "Lender name or part of it (e.g. 'LGE', 'Mazda Financial')" },
      tier: { type: "string", description: "Credit tier name or part of it (e.g. 'Tier 1', 'A+', '740')" },
      termMonths: { type: "number", description: "Loan term in months (e.g. 66, 72)" },
      year: { type: "string", description: "Vehicle model-year band (e.g. '2024')" },
    },
  },
};

export const DECODE_VIN_TOOL = {
  name: "decode_vin",
  description:
    "Decode a 17-character VIN through NHTSA — year, make, model, trim, body, engine — and cross-check whether that VIN is on one of this store's deals or working leads. Use whenever anyone gives you a VIN ('what is this VIN', 'run this VIN', 'whose car is JM3...').",
  input_schema: {
    type: "object",
    properties: { vin: { type: "string", description: "The 17-character VIN" } },
    required: ["vin"],
  },
};

export const SPEED_TO_LEAD_TOOL = {
  name: "speed_to_lead",
  description:
    "The Five-Minute Response System: which fresh ups are on the 5:00 first-contact clock or past it RIGHT NOW, plus the 30-day grade (% answered under five minutes, average, by rep). Use for 'who's on the clock', 'did we answer that lead', 'how's our response time', or whenever coaching speed-to-lead.",
  input_schema: { type: "object", properties: {} },
};

export const CHECK_CONSENT_TOOL = {
  name: "check_consent",
  description:
    "TCPA/consent check on a customer: per-channel (call/text/email) consent status with the audit trail (who recorded what, when, how) and revocation suppression deadlines. ALWAYS run this before drafting or recommending outreach to a specific customer. With no customer given, lists every lead with a revoked channel (the store's do-not-contact list).",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Customer name (or part of one). Omit to list all revoked/do-not-contact leads." },
    },
  },
};

