// THE LOGG → EILA, clean re-import. A finance manager already keeps the month
// in a spreadsheet ("THE LOGG"); this maps that sheet's columns onto EILA's
// per-deal fields so front/back/products land on the RIGHT deal — not a lump
// total. Export THE LOGG as CSV (or copy the rows), paste, preview, import.
//
// Everything here is driven by the USER'S own product menu (ProductDef[]), same
// as log_deal — a product column maps onto THEIR product ids, never a fixed
// list. Pure and deterministic (no clock, no I/O) so it's fully testable; the
// caller passes the reference year for bare M/D dates.

import type { Deal, DealStatus, ProductDef } from "./types";
import { dealUnits } from "./fni";

// ── CSV tokenizer (RFC-4180-ish: quoted fields, "" escapes, newlines in quotes) ──
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\t") {
      row.push(field); field = ""; // tolerate pasted tab-separated (Google Sheets copy)
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  row.push(field);
  rows.push(row);
  // Drop fully-empty trailing rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ── header → canonical field mapping ─────────────────────────────────────────
type Field =
  | "customer" | "dealNumber" | "date" | "salesperson" | "salesperson2"
  | "item" | "bank" | "amount" | "secondary" | "financeNet" | "reserve"
  | "noQualify" | "unitType" | "productUnits" | "note" | "fundingStatus";

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// Alias sets — matched against the normalized header. Order matters: the FIRST
// field whose aliases match wins, so put the specific (back/F&I) before generic.
const FIELD_ALIASES: [Field, string[]][] = [
  ["dealNumber", ["deal", "deal", "dealno", "dealnumber", "dealnum", "contract", "contractno", "acct", "account", "stockno", "stock"]],
  ["date", ["date", "dealdate", "deldate", "delivereddate", "deliverydate", "delivered", "sold", "solddate", "day"]],
  ["customer", ["customer", "customername", "custname", "cust", "name", "buyer", "client", "purchaser"]],
  ["salesperson2", ["salesperson2", "salesperson2nd", "sp2", "cosales", "cosalesperson", "splitwith", "split", "salesperson2name", "seconds", "secondsalesperson"]],
  ["salesperson", ["salesperson", "salesperson1", "salesrep", "salesassociate", "sales", "seller", "rep", "sp", "associate"]],
  ["bank", ["bank", "lender", "lienholder", "financesource", "financecompany", "source"]],
  // The finance manager's actual credit is the ADJUSTED F&I NET (no-qualify deals
  // already zeroed here) — it must win over raw Back Gross when the sheet has both.
  ["financeNet", ["adjustedfinet", "adjustedfni", "adjfinet", "adjustedfandinet", "fininet", "fandinet", "financenet", "finmanagernet", "finmgrnet", "netfandi", "adjustedbackgross", "adjbackgross"]],
  ["secondary", ["back", "backgross", "backend", "backendgross", "fni", "fnigross", "fandi", "fandigross", "fi", "figross", "productgross", "totalproductgross", "backprofit", "fiprofit", "figrossprofit"]],
  ["amount", ["front", "frontgross", "frontend", "frontendgross", "feg", "frontprofit", "vehiclegross", "frontgrossprofit"]],
  ["reserve", ["reserve", "financereserve", "resv", "participation", "reserveprofit"]],
  ["productUnits", ["productunits", "punits", "totalproductunits", "produnits"]],
  ["fundingStatus", ["fundingstatus", "funding", "funded", "fundstatus", "fundstate"]],
  ["unitType", ["unittype", "dealtype", "saletype", "type"]],
  ["noQualify", ["noqualify", "nq", "house", "housedeal", "flat", "mini", "nocharge", "dnq", "donotqualify"]],
  ["item", ["vehicle", "unit", "car", "item", "model", "yearmodel", "vehicledescription", "description", "ymm", "purchasedvehicle", "purchasevehicle", "vehiclepurchased"]],
  ["note", ["notes", "note", "comment", "comments", "remarks"]],
];

// Known generic → product aliases, so THE LOGG's product column headers map onto
// the user's menu even when the header text differs from their label.
const PRODUCT_HEADER_HINTS: [string, string[]][] = [
  ["vsc", ["vsc", "servicecontract", "service", "warranty", "esc", "vscwarranty", "extendedwarranty", "esp"]],
  ["gap", ["gap", "gapinsurance"]],
  ["combo", ["combo", "nas", "nascombo", "bundle", "package"]],
  ["maint", ["maint", "maintenance", "prepaidmaintenance", "ppm", "maintenanceplan"]],
  ["other", ["other", "roadhazard", "tire", "tirewheel", "tireandwheel", "hazard", "twp", "appearance", "dentding", "keyreplacement", "theft"]],
];

export interface LoggColumn {
  index: number;
  header: string;
  field?: Field; // a deal field
  productId?: string; // a product-menu column
}

// Map the header row to fields and product columns, using the user's menu first
// (their exact labels/ids win) then the generic hints.
export function mapColumns(headers: string[], defs: ProductDef[]): LoggColumn[] {
  const takenField = new Set<Field>();
  return headers.map((raw, index) => {
    const h = norm(raw);
    if (!h) return { index, header: raw };

    // 1) A product column? Match the user's own menu first (id or label), then hints.
    const byMenu = defs.find((d) => norm(d.id) === h || norm(d.label) === h);
    if (byMenu) return { index, header: raw, productId: byMenu.id };
    // Generic hints resolve to the user's matching menu item even when their
    // product ids are custom-generated (real menus use ids like "pmrpmkmsk3", so
    // requiring id === "maint" never matched — a "Maint" header silently dropped
    // the Maintenance product). Match the header to a category's hints, then find
    // the user's product by generic id OR by a full label that belongs to that
    // category (exact, no fuzzy substring — so "Other" still maps to "Other").
    for (const [pid, hints] of PRODUCT_HEADER_HINTS) {
      if (!hints.includes(h)) continue;
      const target = defs.find((d) => norm(d.id) === pid || hints.includes(norm(d.label)));
      if (target) return { index, header: raw, productId: target.id };
    }

    // 2) A deal field? First alias set to match, not already taken.
    for (const [field, aliases] of FIELD_ALIASES) {
      if (takenField.has(field)) continue;
      if (aliases.includes(h)) { takenField.add(field); return { index, header: raw, field }; }
    }
    return { index, header: raw };
  });
}

// ── cell parsing ─────────────────────────────────────────────────────────────
export function parseMoney(cell: string): number {
  const t = (cell ?? "").trim();
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = parseFloat(t.replace(/[()$,\s]/g, "").replace(/^-/, ""));
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}

// A product-column cell counts as SOLD when it's a non-zero amount/count or an
// affirmative mark; blank, 0, "-", "n"/"no", or a cross mean not sold. THE LOGG
// marks products with ✔ (U+2714) / ✘ (U+2718), so those are handled explicitly.
const SOLD_MARKS = new Set(["x", "y", "yes", "true", "sold", "1", "✔", "✓", "☑", "✅", "yes✔"]);
const NOT_SOLD_MARKS = new Set(["-", "0", "0.00", "$0", "$0.00", "n", "no", "false", "na", "nan", "✘", "✗", "☒", "x̶"]);
export function cellIsSold(cell: string): boolean {
  const t = (cell ?? "").trim().toLowerCase();
  if (!t) return false;
  if (NOT_SOLD_MARKS.has(t)) return false;
  if (SOLD_MARKS.has(t)) return true;
  const num = parseMoney(t);
  if (num !== 0) return true; // any non-zero dollar/count
  // Any other non-numeric text (a product name in the cell) counts as sold.
  return /[a-z]/.test(t);
}

// Parse a LOGG date cell to a noon-local ISO string (noon so it can't drift
// across a month boundary), matching log_deal. Accepts M/D, M/D/Y, M/D/YY,
// YYYY-MM-DD. `refYear` fills in a bare M/D. Returns null if unparseable.
export function parseLoggDate(cell: string, refYear: number): string | null {
  const t = (cell ?? "").trim();
  if (!t) return null;
  let y: number, mo: number, d: number;
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const mdy = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; }
  else if (mdy) {
    mo = +mdy[1]; d = +mdy[2];
    y = mdy[3] ? (mdy[3].length === 2 ? 2000 + +mdy[3] : +mdy[3]) : refYear;
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00`);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

// ── the import ───────────────────────────────────────────────────────────────
export interface LoggImportResult {
  deals: Omit<Deal, "id">[];
  columns: LoggColumn[];
  warnings: string[];
  skipped: number; // rows dropped (no customer / blank)
  rowCount: number; // data rows seen (excludes header)
}

export interface LoggImportOptions {
  refYear: number; // year for bare M/D dates (UI passes new Date().getFullYear())
  status?: DealStatus; // default "delivered" — a row on THE LOGG is a booked deal
}

// Map a whole THE LOGG CSV to importable deals. Rows without a customer name are
// skipped (blank rows, subtotal/"TOTAL" rows) and counted, not silently lost.
export function parseLoggCsv(csv: string, defs: ProductDef[], opts: LoggImportOptions): LoggImportResult {
  const rows = parseCsv(csv);
  const warnings: string[] = [];
  if (rows.length < 2) {
    return { deals: [], columns: [], warnings: ["No data rows found — paste the header row plus at least one deal."], skipped: 0, rowCount: 0 };
  }
  // Find the HEADER row rather than assuming it's row 0. A raw Google Sheets
  // "Download → CSV" of THE LOGG carries title/instruction rows above the real
  // header ("Deal Log", "Visible columns are for entry/review…"), so row 0 maps
  // nothing and every deal gets skipped. Use the first row that maps a Customer
  // column; fall back to row 0 so a clean header-first paste still works.
  let headerIdx = rows.findIndex((r) => mapColumns(r, defs).some((c) => c.field === "customer"));
  if (headerIdx < 0) headerIdx = 0;
  const columns = mapColumns(rows[headerIdx], defs);
  const col = (f: Field) => columns.find((c) => c.field === f);
  const productCols = columns.filter((c) => c.productId);
  const status = opts.status ?? "delivered";

  const grossCol = col("financeNet") ?? col("secondary"); // finance credit wins over raw back gross
  if (!col("customer")) warnings.push('No "Customer" column matched — rows are keyed on customer name, so nothing will import. Rename that column to "Customer".');
  if (!grossCol) warnings.push('No F&I / back-gross column matched — deals will import with $0 back gross. Rename that column to "Adjusted F&I Net" or "Back Gross".');
  if (!productCols.length) warnings.push("No product columns matched — penetration and spiffs need per-product columns (VSC, GAP, NAS Combo, Maintenance, Other).");

  const cellAt = (r: string[], f: Field) => { const c = col(f); return c ? (r[c.index] ?? "") : ""; };
  const deals: Omit<Deal, "id">[] = [];
  let skipped = 0;
  const dataRows = rows.slice(headerIdx + 1);

  for (const r of dataRows) {
    const customer = cellAt(r, "customer").trim();
    if (!customer || /^(total|subtotal|totals|grand total|sum)$/i.test(customer)) { skipped++; continue; }

    const products = productCols.filter((c) => cellIsSold(r[c.index] ?? "")).map((c) => c.productId!);
    const dateIso = parseLoggDate(cellAt(r, "date"), opts.refYear);
    // No-qualify (DNQ): an explicit no-qualify column OR a Unit Type of "Do Not
    // Qualify" / "House". These keep the salesperson's unit but carry $0 F&I credit
    // and are excluded from the finance manager's retail touches (see fniPayPicture).
    const unitType = cellAt(r, "unitType").trim();
    const noQ = (col("noQualify") ? cellIsSold(cellAt(r, "noQualify")) : false) || /do\s*not\s*qualify|dnq|^house/i.test(unitType);
    // Product-only: THE LOGG marks these with Unit Type "Product Only" (and vehicle
    // "PRODUCT ONLY"). Its back gross + products still count toward PVR/PPU, but it
    // is not a vehicle unit — so carry the flag through (see lib/productOnly.ts).
    const productOnly = /product\s*only/i.test(unitType) || /product\s*only/i.test(cellAt(r, "item"));
    // F&I credit: prefer the Adjusted F&I Net column (already $0 on DNQ); fall back
    // to Back Gross. Force $0 on no-qualify regardless of what the raw column shows.
    const gross = grossCol ? Math.max(0, parseMoney(r[grossCol.index] ?? "")) : 0;
    // Product Units: THE LOGG's own count is authoritative (a bundle like NAS Combo
    // weighs 5), so it drives the grid PPU directly; otherwise derive from the menu.
    const puCol = col("productUnits");
    const productUnits = puCol ? Math.max(0, parseMoney(r[puCol.index] ?? "")) : undefined;
    const note = cellAt(r, "note").trim();
    const funding = cellAt(r, "fundingStatus").trim();
    const funded = funding ? !/not\s*funded|unfunded|pending|^no$/i.test(funding) : true;

    const deal: Omit<Deal, "id"> = {
      date: dateIso ?? new Date(`${opts.refYear}-01-01T12:00:00`).toISOString(),
      customer,
      item: cellAt(r, "item").trim(),
      amount: Math.max(0, parseMoney(cellAt(r, "amount"))),
      secondary: noQ ? 0 : gross, // no-qualify carries $0 F&I credit
      reserve: Math.max(0, parseMoney(cellAt(r, "reserve"))),
      addons: 0,
      status,
      ...(category(unitType) ? { category: category(unitType) } : {}),
      ...(products.length ? { products } : {}),
      ...(noQ ? { noQualify: true } : {}),
      ...(productOnly ? { productOnly: true } : {}),
      ...(cellAt(r, "salesperson").trim() ? { salesperson: cellAt(r, "salesperson").trim() } : {}),
      ...(cellAt(r, "salesperson2").trim() ? { salesperson2: cellAt(r, "salesperson2").trim() } : {}),
      ...(cellAt(r, "bank").trim() ? { bank: cellAt(r, "bank").trim() } : {}),
      ...(cellAt(r, "dealNumber").trim() ? { dealNumber: cellAt(r, "dealNumber").trim() } : {}),
      ...(note ? { note } : {}),
      funded,
    };
    // addons = product units (the app's PPU driver): THE LOGG's count if present,
    // else the menu-weighted sum of the sold products.
    deal.addons = productUnits !== undefined ? productUnits : (products.length ? dealUnits(deal as Deal, defs) : 0);
    if (!dateIso && col("date")) warnings.push(`Couldn't read the date for ${customer} — imported into ${opts.refYear}. Fix it on the deal if needed.`);
    deals.push(deal);
  }

  return { deals, columns, warnings, skipped, rowCount: dataRows.length };
}

// ── re-sync: match on Deal # and UPDATE, don't duplicate ─────────────────────
// A month gets re-imported after adjustments (a bank chargeback trims an F&I
// net, a product is added). Matching each incoming row to an existing deal by
// Deal # lets a re-import CORRECT the deal in place instead of stacking a
// duplicate — so EILA re-syncs to THE LOGG's latest numbers automatically.
//
// Merge rule: incoming (THE LOGG's truth) wins for every field it carries, but
// the existing deal's id and app-only fields it doesn't touch (phone, follow-up
// reminder, saved jacket) are preserved. Rows with no Deal # can't be matched,
// so they always add. `makeId` is injected so this stays pure/testable.
export interface ReconcileResult {
  deals: Deal[];
  added: number;
  updated: number;
}

export function reconcileImport(
  existing: Deal[],
  incoming: Omit<Deal, "id">[],
  makeId: () => string,
): ReconcileResult {
  const key = (n?: string) => (n ? n.trim().toLowerCase() : "");
  const incByNum = new Map<string, Omit<Deal, "id">>();
  const incNoNum: Omit<Deal, "id">[] = [];
  for (const inc of incoming) {
    const k = key(inc.dealNumber);
    if (k) incByNum.set(k, inc); // last row for a Deal # wins
    else incNoNum.push(inc);
  }
  let updated = 0;
  const matched = new Set<string>();
  const updatedExisting = existing.map((d) => {
    const k = key(d.dealNumber);
    const inc = k ? incByNum.get(k) : undefined;
    if (inc && !matched.has(k)) { updated++; matched.add(k); return { ...d, ...inc, id: d.id }; }
    return d;
  });
  const fresh: Deal[] = [];
  for (const [k, inc] of incByNum) if (!matched.has(k)) fresh.push({ ...inc, id: makeId() });
  for (const inc of incNoNum) fresh.push({ ...inc, id: makeId() });
  return { deals: [...fresh, ...updatedExisting], added: fresh.length, updated };
}

// Unit Type → a deal category (automotive): New/Used/CPO/Lease. DNQ and
// "Product Only" aren't retail categories, so they carry none.
function category(unitType: string): string | undefined {
  const t = unitType.toLowerCase();
  if (/lease/.test(t)) return "lease";
  if (/new/.test(t)) return "new";
  if (/used|cpo|certified|pre.?owned/.test(t)) return "used";
  return undefined;
}
