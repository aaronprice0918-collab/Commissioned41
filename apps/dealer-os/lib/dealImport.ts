import { type Deal, type FinanceStatus, type VehicleClass } from "@/lib/data";

// What EILA returns per deal when she parses a pasted log. A loose, forgiving
// shape — every field optional except the customer — because the source can be
// a clean Reynolds export or a rough "20 cars" phone dump. buildDeal() fills the
// gaps and turns each row into a full Deal.
export type ParsedDeal = {
  dealNumber?: string;
  date?: string; // ideally YYYY-MM-DD; stored as-is if EILA can't normalize it
  customer: string;
  stockNumber?: string;
  vehicle?: string; // "2024 Mazda CX-90" — kept for reference, no dedicated field
  vehicleClass?: VehicleClass;
  salesperson?: string; // full roster name (EILA maps last-name -> roster)
  salesperson2?: string;
  manager?: string; // the sales/desk manager, full roster name
  financeManager?: string;
  lender?: string;
  term?: number;
  reserve?: number; // finance reserve portion of the back end
  backGross?: number; // total back-end gross (reserve + products)
  frontGross?: number; // front/commission gross EXCLUDING doc fee
  docFee?: number;
  vin?: string;
  cashDeal?: boolean;
  financeStatus?: FinanceStatus;
  // Per-deal products when the source carries them (a personal F&I grid with
  // check/x columns). Absent for product-blind logs like the DMS deal log.
  products?: {
    vsc?: boolean;
    gap?: boolean;
    maintenance?: boolean;
    permaplate?: boolean;
    tws?: boolean;
    utp?: boolean;
  };
  // The row's PRINTED total-gross column, when the log shows one. Never stored
  // on the Deal — it exists so the review step can verify the extraction:
  // front + back + doc fee must reproduce the source's own printed total.
  totalGross?: number;
};

export type ImportTotals = { units: number; back: number; front: number; total: number };

export function importTotals(rows: { frontGross: number; backGrossReserve: number }[]): ImportTotals {
  const back = rows.reduce((sum, d) => sum + d.backGrossReserve, 0);
  const front = rows.reduce((sum, d) => sum + d.frontGross, 0);
  return { units: rows.length, back, front, total: back + front };
}

let importSeq = 0;
function importId(dealNumber?: string) {
  importSeq += 1;
  const base = dealNumber && dealNumber.trim() ? dealNumber.trim().replace(/\s+/g, "") : `row${importSeq}`;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : `${importSeq}`;
  return `imp-${base}-${rand}`;
}

// Convert one parsed row into a full, store-ready Deal. Deals from a posted F&I
// log are booked, so they land as "Delivered" (counts as a sold unit). Cash
// deals are "Not Classified" so they don't inflate F&I penetration; everything
// else is "Classified" (a finance deal). No product breakdown comes from these
// logs, so products start empty — back gross still drives PVR/gross.
export function buildDeal(parsed: ParsedDeal): Deal {
  const cash = parsed.cashDeal ?? /cash\s*deal/i.test(parsed.lender ?? "");
  const financeStatus: FinanceStatus = parsed.financeStatus ?? (cash ? "Not Classified" : "Classified");
  return {
    id: importId(parsed.dealNumber),
    dealNumber: parsed.dealNumber?.trim() || undefined,
    date: parsed.date ?? "",
    customer: (parsed.customer ?? "").trim(),
    stockNumber: parsed.stockNumber ?? "",
    vin: parsed.vin ?? "",
    vehicleClass: parsed.vehicleClass ?? "New",
    salesperson: parsed.salesperson ?? "",
    salesperson2: parsed.salesperson2 || undefined,
    manager: parsed.manager ?? "",
    financeManager: parsed.financeManager ?? "",
    lender: parsed.lender ?? "",
    tradeInfo: "",
    frontGross: Math.round(parsed.frontGross ?? 0),
    // When the source log has no separate doc-fee column (most DMS deal logs
    // bake it into the Front), default to 0 — NEVER fall back to the store doc
    // fee, which would double-count it on top of a front that already includes it.
    docFee: parsed.docFee != null ? Math.round(parsed.docFee) : 0,
    backGrossReserve: Math.round(parsed.backGross ?? 0),
    reserve: parsed.reserve != null ? Math.round(parsed.reserve) : undefined,
    products: parsed.products ?? {},
    financeStatus,
    cashDeal: cash,
    stage: "Delivered",
    missionDebrief: parsed.vehicle ?? "",
  };
}

// Drop empty strings / undefined so a sparse source (e.g. a product-blind DMS
// log) never wipes a value an existing deal already has. Numbers and booleans
// (including 0/false) are kept — they're real data.
function meaningfulFields(deal: Deal): Partial<Deal> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(deal)) {
    if (value === undefined || value === "") continue;
    out[key] = value;
  }
  return out as Partial<Deal>;
}

// Merge an incoming batch into the current deals by deal number: a match ENRICHES
// the existing deal (incoming non-empty fields win; products union so neither
// source erases the other's); unmatched incoming deals are prepended. This is what
// lets a rich personal grid layer products/VIN onto deals first loaded from the
// product-blind DMS log without creating duplicates.
function enrich(existing: Deal, inc: Deal): Deal {
  return {
    ...existing,
    ...meaningfulFields(inc),
    id: existing.id, // keep the stable id
    products: { ...existing.products, ...inc.products },
  };
}

export function mergeDeals(current: Deal[], incoming: Deal[]): Deal[] {
  const result = [...current];
  const indexByNumber = new Map<string, number>();
  current.forEach((deal, i) => {
    const key = deal.dealNumber?.trim();
    if (key) indexByNumber.set(key, i);
  });
  const appended: Deal[] = [];
  // Track appended deals by number too, so two rows with the SAME deal # inside a
  // single batch (a log that lists a deal twice) merge into one instead of both
  // landing as duplicates.
  const appendedByNumber = new Map<string, number>();
  for (const inc of incoming) {
    const key = inc.dealNumber?.trim();
    const existingIdx = key ? indexByNumber.get(key) : undefined;
    if (existingIdx != null) {
      result[existingIdx] = enrich(result[existingIdx], inc);
      continue;
    }
    const appendedIdx = key ? appendedByNumber.get(key) : undefined;
    if (appendedIdx != null) {
      appended[appendedIdx] = enrich(appended[appendedIdx], inc);
      continue;
    }
    if (key) appendedByNumber.set(key, appended.length);
    appended.push(inc);
  }
  return [...appended, ...result];
}

export type ImportMode = "replace" | "add" | "merge";

export function applyImport(current: Deal[], incoming: Deal[], mode: ImportMode): Deal[] {
  if (mode === "replace") return incoming;
  if (mode === "merge") return mergeDeals(current, incoming);
  return [...incoming, ...current];
}

// ── Expanded / phone-layout log linearizer ───────────────────────────────────
// Some DMS screens paste as ONE FIELD PER LINE (a mobile "expanded rows" table):
//   N \n New \n 1560 \n 7/1/26 \n 7/2/26 \n F \n 1 \n ASKEW \n ... \n Expand N
// Scattered like that, field-to-deal association is exactly where an AI parse
// goes wrong. When (and only when) that shape is detected, rebuild the paste as
// one pipe-joined line per deal BEFORE it reaches EILA. Any other paste returns
// null and flows through completely untouched.
const ROW_TYPE = /^(N|U|W)$/;
const ROW_CLASS = /^(New|Used|Wholesale)$/;
const ROW_DEALNUM = /^\d{3,7}$/;

export function linearizeExpandedLog(text: string): string | null {
  const rawLines = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const raw of rawLines) {
    let line = raw.trim();
    if (!line) continue;
    // "Expand" is UI chrome; the token after it (if any) is the NEXT row's
    // type flag that got glued onto the same line — keep that part.
    if (/^Expand\b/i.test(line)) {
      line = line.replace(/^Expand\b/i, "").trim();
      if (!line) continue;
    }
    lines.push(line);
  }

  // A record starts at: type flag (N/U/W) → class (New/Used/Wholesale) → deal #.
  const isRecordStart = (i: number) =>
    ROW_TYPE.test(lines[i] ?? "") && ROW_CLASS.test(lines[i + 1] ?? "") && ROW_DEALNUM.test(lines[i + 2] ?? "");

  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) if (isRecordStart(i)) starts.push(i);

  // Detection bar: at least 3 unmistakable record starts, and the text must
  // actually be the one-field-per-line shape (records span many lines). A normal
  // CSV/TSV row contains its whole deal on one line and never matches.
  if (starts.length < 3) return null;
  const span = (starts[starts.length - 1] - starts[0]) / (starts.length - 1);
  if (span < 8) return null;

  const records: string[] = [];
  for (let s = 0; s < starts.length; s += 1) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const fields = lines.slice(from, to);
    // The "Expand N" chrome leaves the NEXT record's type flag glued to this
    // record's tail — a lone trailing N/U/W is never real deal data.
    while (fields.length > 3 && ROW_TYPE.test(fields[fields.length - 1])) fields.pop();
    records.push(fields.join(" | "));
  }
  return records.map((record) => `DEAL ROW: ${record}`).join("\n");
}

// ── Source-total reconciliation ──────────────────────────────────────────────
// When the log prints its own per-row total gross, the extraction must
// reproduce it: front + back + doc fee = printed total (±$1 for source
// rounding). A row that can't reconcile means a number landed in the wrong
// column — exactly the failure the review step must refuse to commit silently.
export type ImportMismatch = { index: number; customer: string; expected: number; got: number };

export function importMismatches(built: Deal[], raw: ParsedDeal[]): ImportMismatch[] {
  const out: ImportMismatch[] = [];
  raw.forEach((row, index) => {
    if (typeof row.totalGross !== "number") return;
    const deal = built[index];
    if (!deal) return;
    const got = deal.frontGross + deal.backGrossReserve + (deal.docFee ?? 0);
    if (Math.abs(got - Math.round(row.totalGross)) > 1) {
      out.push({ index, customer: deal.customer, expected: Math.round(row.totalGross), got });
    }
  });
  return out;
}
