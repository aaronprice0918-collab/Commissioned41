// Monthly setup = EILA's "fuel": the reference data a store re-loads each month
// (lender rate sheets, OEM incentives, lease residuals). A doc is dropped in,
// EILA extracts it into one of these shapes, the user confirms, and it's saved
// to the `monthlySetup` store key — then EILA reads it into her context so she
// can quote the right rate / rebate / residual.
//
// v1 ships lender rate sheets end-to-end; incentives and residuals share the
// exact same pipeline (registry below) so they light up by adding their renderer.

export type DocType = "rateSheets" | "incentives" | "residuals";

// ---- Lender rate sheets -----------------------------------------------------
// Many bank/CU sheets price the buy rate by vehicle model-year as well as tier &
// term (e.g. a 2024 66mo is cheaper than a 2020 66mo). `year` captures that band
// when present; sheets that don't vary by year just omit it.
export type RateRow = { termMonths: number; buyRate: number; maxAdvancePct?: number; year?: string; minAmountFinanced?: number };
export type RateTier = { tier: string; rates: RateRow[] };
export type LenderRates = { lender: string; tiers: RateTier[]; notes?: string };
export type RateSheetData = { effectiveMonth?: string; lenders: LenderRates[]; notes?: string };

// ---- OEM incentives / rebates ----------------------------------------------
export type IncentiveOffer = { model: string; offerType: string; detail: string; expires?: string };
export type IncentivesData = { effectiveMonth?: string; offers: IncentiveOffer[]; notes?: string };

// ---- Lease residuals / money factor ----------------------------------------
export type ResidualRow = { model: string; termMonths: number; mileage: number; residualPct: number; moneyFactor?: number };
export type ResidualsData = { effectiveMonth?: string; rows: ResidualRow[]; notes?: string };

export type SetupMeta = { updatedAt: string; updatedBy?: string; sourceFile?: string };

// What lands in the store under the `monthlySetup` key — the latest confirmed
// extraction per doc type, each stamped with when/by whom it went live.
export type MonthlySetup = {
  rateSheets?: RateSheetData & SetupMeta;
  incentives?: IncentivesData & SetupMeta;
  residuals?: ResidualsData & SetupMeta;
};

export type ExtractedData = RateSheetData | IncentivesData | ResidualsData;

type DocTypeDef = {
  key: DocType;
  label: string;
  blurb: string;
  // What the doc usually is, to steer the extraction.
  examples: string;
};

export const DOC_TYPES: DocTypeDef[] = [
  {
    key: "rateSheets",
    label: "Lender rate sheets",
    blurb: "Buy rates by lender, credit tier and term. Feeds desking & reserve.",
    examples: "a bank/credit-union rate sheet with buy rates by credit tier (e.g. Tier 1 720+, Tier 2 …) across terms (60/66/72/75 mo), often with max-advance/LTV.",
  },
  {
    key: "incentives",
    label: "OEM incentives / rebates",
    blurb: "Current factory offers — customer cash, special APR, lease cash.",
    examples: "a manufacturer incentive bulletin listing offers per model — customer cash/rebate, special APR, lease cash, loyalty/conquest — with expiration dates.",
  },
  {
    key: "residuals",
    label: "Lease residuals / money factor",
    blurb: "Residual % and money factor by model, term and mileage.",
    examples: "a lease residual sheet: residual percentages (and money factor) by model across terms (24/36/39 mo) and annual mileage (10k/12k/15k).",
  },
];

export function docTypeDef(key: DocType): DocTypeDef {
  return DOC_TYPES.find((d) => d.key === key) ?? DOC_TYPES[0];
}

// A short headline of what was extracted, for the preview ("12 lenders, 48 tiers").
export function summarizeExtraction(docType: DocType, data: ExtractedData): string {
  if (docType === "rateSheets") {
    const d = data as RateSheetData;
    const lenders = d.lenders?.length ?? 0;
    const tiers = (d.lenders ?? []).reduce((n, l) => n + (l.tiers?.length ?? 0), 0);
    const rates = (d.lenders ?? []).reduce((n, l) => n + (l.tiers ?? []).reduce((m, t) => m + (t.rates?.length ?? 0), 0), 0);
    return `${lenders} lender${lenders === 1 ? "" : "s"} · ${tiers} tier${tiers === 1 ? "" : "s"} · ${rates} rate${rates === 1 ? "" : "s"}`;
  }
  if (docType === "incentives") {
    const d = data as IncentivesData;
    const offers = d.offers?.length ?? 0;
    return `${offers} offer${offers === 1 ? "" : "s"}`;
  }
  const d = data as ResidualsData;
  const rows = d.rows?.length ?? 0;
  return `${rows} residual row${rows === 1 ? "" : "s"}`;
}

export function extractionIsEmpty(docType: DocType, data: ExtractedData): boolean {
  if (docType === "rateSheets") return !((data as RateSheetData).lenders?.length);
  if (docType === "incentives") return !((data as IncentivesData).offers?.length);
  return !((data as ResidualsData).rows?.length);
}

const pct = (n: number) => `${(+n).toFixed(2)}%`;

// Render the live setup into a compact block for EILA's context. Bounded so a
// huge rate book can't blow the prompt — EILA gets the gist + is told to ask
// for specifics if a lender/term isn't shown.
export function formatSetupForEILA(setup: MonthlySetup | null | undefined): string {
  if (!setup) return "";
  const parts: string[] = [];

  if (setup.rateSheets?.lenders?.length) {
    const rs = setup.rateSheets;
    const lines = rs.lenders.slice(0, 25).map((l) => {
      const tiers = (l.tiers ?? []).slice(0, 10).map((t) => {
        // Rates can fan out by model-year AND term, so allow many per tier.
        const rates = (t.rates ?? []).slice(0, 60).map((r) => `${r.year ? `${r.year} ` : ""}${r.termMonths}mo ${pct(r.buyRate)}${r.maxAdvancePct ? ` (≤${r.maxAdvancePct}%)` : ""}`).join(", ");
        return `${t.tier}: ${rates}`;
      }).join(" | ");
      return `  - ${l.lender}: ${tiers}${l.notes ? ` [${l.notes}]` : ""}`;
    });
    parts.push(`CURRENT LENDER RATE SHEET${rs.effectiveMonth ? ` (effective ${rs.effectiveMonth})` : ""} — these are BUY rates; reserve = sell minus buy within the lender's cap:\n${lines.join("\n")}`);
  }

  if (setup.incentives?.offers?.length) {
    const inc = setup.incentives;
    const lines = inc.offers.slice(0, 40).map((o) => `  - ${o.model}: ${o.offerType} — ${o.detail}${o.expires ? ` (exp ${o.expires})` : ""}`);
    parts.push(`CURRENT OEM INCENTIVES${inc.effectiveMonth ? ` (effective ${inc.effectiveMonth})` : ""}:\n${lines.join("\n")}`);
  }

  if (setup.residuals?.rows?.length) {
    const res = setup.residuals;
    const lines = res.rows.slice(0, 50).map((r) => `  - ${r.model} ${r.termMonths}mo/${r.mileage}k: ${pct(r.residualPct)} residual${r.moneyFactor ? `, MF ${r.moneyFactor}` : ""}`);
    parts.push(`CURRENT LEASE RESIDUALS${res.effectiveMonth ? ` (effective ${res.effectiveMonth})` : ""}:\n${lines.join("\n")}`);
  }

  if (!parts.length) return "";
  return `${parts.join("\n\n")}\n\nUse these CURRENT figures when quoting rate, payment, rebate or lease. If a specific lender/tier/term/model isn't listed here, say you don't have that line loaded rather than guessing.`;
}
