import type { PayCycle, PlanVocabulary } from "./payEngine";

export type VehicleClass = "New" | "Used" | "Wholesale";
export type FinanceStatus = "Classified" | "Not Classified" | "DNQ";

// Car lingo for the screens. The STORED values stay the same (so prod data and
// the math are untouched); these are just what the desk SEES. "Classified" was
// internal-speak — a deal that counts toward F&I is simply a "Finance" deal.
export const financeStatusLabels: Record<FinanceStatus, string> = {
  "Classified": "Finance",
  "Not Classified": "Cash",
  "DNQ": "DNQ",
};
export function financeStatusLabel(status: FinanceStatus): string {
  return financeStatusLabels[status] ?? status;
}
export type DealStage = "Desk" | "Contracted" | "Funded" | "Delivered";
// Display labels for the deal pipeline. STORED stage values stay the same (the
// math reads "Delivered"/"Funded" directly); a completed/delivered deal simply
// READS as "Finalized" on the screens. Pairs with the office-clean gate.
export const dealStageLabels: Record<DealStage, string> = {
  "Desk": "Desk",
  "Contracted": "Contracted",
  "Funded": "Funded",
  "Delivered": "Finalized",
};
export function dealStageLabel(stage: DealStage): string {
  return dealStageLabels[stage] ?? stage;
}
export type RdrStatus = "Not Punched" | "Pending" | "Punched";

export type TeamMember = {
  name: string;
  role: "Sales" | "BDC" | "F&I" | "Manager" | "Service" | "Parts" | "Administration";
  title: string;
  rank: string;
  mission: string;
  phone: string;
  email: string;
  employeeNumber?: string;
  unitGoal?: number;
};

export type Deal = {
  id: string;
  // The dealership's deal/log number (Reynolds "Deal #"). Optional — older deals
  // predate it — but when present it's the stable key the Import screen merges on
  // (enrich a product-blind deal with a richer source by deal #).
  dealNumber?: string;
  date: string;
  customer: string;
  // Customer street address — PII, redacted for Sales/BDC on deals they didn't
  // write (same rule as customer/vin in the store route).
  customerAddress?: string;
  stockNumber: string;
  vin: string;
  vehicleClass: VehicleClass;
  salesperson: string;
  salesperson2?: string;
  manager: string;
  financeManager: string;
  lender: string;
  tradeInfo: string;
  tradeYear?: string;
  tradeMake?: string;
  tradeModel?: string;
  tradeVin?: string;
  tradeAcv?: number;
  tradePayoff?: number;
  frontGross: number;
  docFee?: number;
  backGrossReserve: number;
  reserve?: number;
  invoiceAmount?: number;
  // Back-end "Recap" fields the F&I manager trues up after the deal is done.
  // buyRate/sellRate drive the reserve (reserve lives in `reserve` above); the
  // rest are the office numbers handed to accounting. Display-only to the math
  // except `reserve`, which feeds back gross.
  buyRate?: number;
  sellRate?: number;
  bankFee?: number;
  weOwe?: string;
  roNumber?: string;
  // Lease deal. A lease is always a New unit and tracks like any new-car deal in
  // the reports (units + F&I gross) — `isLease` just flags it so it's
  // identifiable. The lease summary (from the lease desk) is stored for display.
  isLease?: boolean;
  leaseMonthlyPayment?: number;
  leaseTermMonths?: number;
  leaseDueAtSigning?: number;
  products: {
    vsc?: boolean;
    gap?: boolean;
    maintenance?: boolean;
    permaplate?: boolean;
    tws?: boolean;
    utp?: boolean;
  };
  financeStatus: FinanceStatus;
  cashDeal?: boolean;
  stage: DealStage;
  rdrStatus?: RdrStatus;
  rdrDate?: string;
  rdrNotes?: string;
  missionDebrief: string;
  // Office-clean "Ready to Post" gate (see officeChecks below). `readyToPost` is
  // the F&I manager's explicit sign-off that the deal is clean enough to key into
  // the DMS/accounting; `officeChecklist` holds the manual confirmations (taxes,
  // stips, docs) that have no underlying data to compute.
  readyToPost?: boolean;
  readyToPostAt?: string;
  officeChecklist?: Partial<Record<OfficeManualKey, boolean>>;
  // Deal-jacket progress, keyed by document NAME from the store's jacket order
  // (lib/dealJacket.ts). Absent key = doc still missing from the physical file.
  jacketDocs?: Record<string, "have" | "na">;
  // The blue folder — the sorted deal-jacket PDF filed for 90 days (lib/
  // jacketFile.ts owns the retention math; /api/jacket-file owns the storage).
  jacketFile?: { path: string; pages: number; savedAt: string };
};

export const goals = {
  storeName: "Kennesaw Mazda",
  deliveredUnits: 130,
  pvrTotal: 3000,
  backEnd: 1800,
  frontEnd: 1200,
  ppuMinimum: 2.0,
  ppuElite: 2.5,
};

export const productWeights = {
  vsc: 1,
  gap: 1,
  maintenance: 1,
  permaplate: 1,
  tws: 1,
  utp: 5,
};

export const productLabels = {
  vsc: "VSC",
  gap: "GAP",
  maintenance: "Maint",
  permaplate: "Permaplate",
  tws: "TWS",
  utp: "UTP",
};

export const defaultDocFee = 899;

// ── Per-org Store Settings ────────────────────────────────────────────────
// The FORMULAS are the same for every dealership, but the CONSTANTS they feed
// on are store/state-specific (doc fee, holdback %, tax, product weights, and
// the PVR/unit targets). These live in an org-scoped `storeSettings` app_store
// record. `StoreSettingsProvider` loads the active org's record and pushes it
// into the module cache below, so the pure math functions in this file read the
// caller's store config — falling back to the Kennesaw/GA defaults (Org #1).
export type ProductKey = keyof typeof productWeights;

export type TaxRule = {
  // Rate as a fraction (GA TAVT = 0.07). `basis` is what the rate applies to.
  rate: number;
  label: string;
  basis: "price_plus_docfee" | "price";
};

export type StoreTargets = {
  deliveredUnits: number;
  pvrTotal: number;
  frontEnd: number;
  backEnd: number;
  ppuMinimum: number;
  ppuElite: number;
};

export type StoreSettings = {
  storeName: string;
  docFee: number;
  // Manufacturer holdback as a fraction of invoice (Mazda new = 0.06).
  holdbackPct: number;
  tax: TaxRule;
  productWeights: Record<ProductKey, number>;
  targets: StoreTargets;
  // Org-wide pay-cycle + vocabulary defaults, used when a plan doesn't set its
  // own. Absent = calendar-month / USD / automotive wording (the historical
  // behavior). A plan's own cycle/vocab always overrides these.
  payCycle?: PayCycle;
  vocab?: PlanVocabulary;
  // The Dealer Mission OS Assistant (EILA) is a per-store paid add-on. Omitted/true =
  // available to everyone at the store; false = off for this store. Owner is
  // always allowed regardless. Flips to a billing-driven flag when Stripe lands.
  aiAssistantEnabled?: boolean;
  // The store's required deal-jacket document order (one name per entry).
  // Absent/empty = the house default in lib/dealJacket.ts.
  dealJacketOrder?: string[];
};

export const defaultStoreSettings: StoreSettings = {
  storeName: goals.storeName,
  docFee: defaultDocFee,
  holdbackPct: 0.06,
  tax: { rate: 0.07, label: "GA TAVT", basis: "price_plus_docfee" },
  productWeights: { ...productWeights },
  targets: {
    deliveredUnits: goals.deliveredUnits,
    pvrTotal: goals.pvrTotal,
    frontEnd: goals.frontEnd,
    backEnd: goals.backEnd,
    ppuMinimum: goals.ppuMinimum,
    ppuElite: goals.ppuElite,
  },
  payCycle: { mode: "calendarMonth", periodNoun: "month" },
  vocab: { currency: "USD", unitNoun: "unit", periodNoun: "month" },
};

// Module-level cache of the active org's settings. Defaults to Kennesaw so the
// math is correct before the provider loads (and on the server, where the crm
// route is pinned to the default org today). The provider overwrites this.
let activeStoreSettings: StoreSettings = defaultStoreSettings;

export function setActiveStoreSettings(next: StoreSettings) {
  activeStoreSettings = next;
}

export function getActiveStoreSettings(): StoreSettings {
  return activeStoreSettings;
}

// ── Office-clean "Ready to Post" gate ─────────────────────────────────────────
// The bounce-back killer. Before a deal is keyed into the dealer's DMS/accounting
// (Reynolds at Kennesaw), Dealer Mission OS runs a quick office-clean pass. Dealer Mission OS is
// NOT the DMS — this is the clean gate that sits IN FRONT of it, so the office
// keys a verified deal once instead of getting it bounced back. The gate is
// ADVISORY: it surfaces warnings but never blocks. The F&I manager can mark a
// deal "Ready to Post" with open warnings — their call. Most checks are computed
// from the deal; the three with no underlying data (taxes, stips, docs) are
// manual confirmations stored on the deal in `officeChecklist`.
export type OfficeManualKey = "taxes" | "stips" | "docs";

export type OfficeCheck = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  manual: boolean;
  manualKey?: OfficeManualKey;
};

export function officeChecks(deal: Deal, settings: StoreSettings = getActiveStoreSettings()): OfficeCheck[] {
  const financed = !deal.cashDeal && deal.financeStatus === "Classified";
  const retail = deal.vehicleClass === "New" || deal.vehicleClass === "Used";
  const manual = deal.officeChecklist || {};
  const reserve = deal.reserve ?? 0;
  const totalGross = deal.frontGross + deal.backGrossReserve;
  const productCount = Object.values(deal.products || {}).filter(Boolean).length;
  const checks: OfficeCheck[] = [];

  // Gross reconciles — front + back are real numbers and reserve fits inside back gross.
  const grossOk = Number.isFinite(deal.frontGross) && Number.isFinite(deal.backGrossReserve) && reserve <= deal.backGrossReserve + 0.01;
  checks.push({
    key: "gross", manual: false, ok: grossOk, label: "Gross reconciles",
    detail: grossOk ? `Front + back ties to ${currency(totalGross)}` : "Reserve is larger than back gross — the numbers don't tie out.",
  });

  // Lender / cash set.
  const lenderOk = Boolean(deal.cashDeal) || (deal.lender.trim() !== "" && deal.lender !== "Pending");
  checks.push({
    key: "lender", manual: false, ok: lenderOk, label: "Lender / cash set",
    detail: lenderOk ? (deal.cashDeal ? "Cash deal" : deal.lender) : "No bank selected on a financed deal.",
  });

  // F&I manager assigned.
  const fmOk = deal.financeManager.trim() !== "";
  checks.push({
    key: "financeManager", manual: false, ok: fmOk, label: "F&I manager assigned",
    detail: fmOk ? displayPersonName(deal.financeManager) : "No F&I manager on the deal.",
  });

  // New cars: invoice on file so holdback can be verified.
  if (deal.vehicleClass === "New") {
    const hbOk = Boolean(deal.invoiceAmount && deal.invoiceAmount > 0);
    checks.push({
      key: "holdback", manual: false, ok: hbOk, label: "Invoice on file (holdback)",
      detail: hbOk ? `${currency(deal.invoiceAmount! * settings.holdbackPct)} holdback @ ${Math.round(settings.holdbackPct * 100)}%` : "No invoice amount — 6% holdback can't be verified.",
    });
  }

  // Financed deals should show the menu was presented (≥1 product).
  if (financed) {
    const prodOk = productCount > 0;
    checks.push({
      key: "products", manual: false, ok: prodOk, label: "Products presented",
      detail: prodOk ? `${productCount} product${productCount === 1 ? "" : "s"} on the car` : "Zero products on a financed deal — menu may have been skipped.",
    });
  }

  // Retail deals carry a doc fee.
  if (retail) {
    const docOk = Boolean(deal.docFee && deal.docFee > 0);
    checks.push({
      key: "docFee", manual: false, ok: docOk, label: "Doc fee applied",
      detail: docOk ? currency(deal.docFee!) : "No doc fee on the deal.",
    });
  }

  // Manual confirmations — no data to compute, the office checks these off.
  checks.push({
    key: "taxes", manual: true, manualKey: "taxes", ok: Boolean(manual.taxes), label: "Taxes & fees verified",
    detail: "Tax, title, and fees match the state worksheet.",
  });
  if (financed) {
    checks.push({
      key: "stips", manual: true, manualKey: "stips", ok: Boolean(manual.stips), label: "Lender stipulations met",
      detail: "Proof of income/residence and any lender conditions cleared.",
    });
  }
  checks.push({
    key: "docs", manual: true, manualKey: "docs", ok: Boolean(manual.docs), label: "Every document signed",
    detail: "All customer and lender signatures captured.",
  });

  return checks;
}

export function officeCheckSummary(deal: Deal, settings?: StoreSettings) {
  const checks = officeChecks(deal, settings);
  const open = checks.filter((c) => !c.ok);
  return { checks, total: checks.length, passed: checks.length - open.length, open, clean: open.length === 0 };
}

function numOr(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

// Coerce a stored (possibly partial / old-shape / {} ) storeSettings record into
// a complete StoreSettings, falling back to Kennesaw/GA defaults field by field.
// Shared by the client provider AND the server (EILA) so they never drift.
export function mergeStoreSettings(saved: Partial<StoreSettings> | null | undefined): StoreSettings {
  const d = defaultStoreSettings;
  if (!saved || typeof saved !== "object") return d;
  const savedWeights = (saved.productWeights ?? {}) as Partial<Record<ProductKey, number>>;
  const productWeights = Object.fromEntries(
    (Object.keys(d.productWeights) as ProductKey[]).map((key) => [key, numOr(savedWeights[key], d.productWeights[key])])
  ) as Record<ProductKey, number>;
  const savedTargets: Partial<StoreTargets> = saved.targets ?? {};
  const savedTax: Partial<TaxRule> = saved.tax ?? {};
  return {
    storeName: typeof saved.storeName === "string" && saved.storeName.trim() ? saved.storeName : d.storeName,
    docFee: numOr(saved.docFee, d.docFee),
    holdbackPct: numOr(saved.holdbackPct, d.holdbackPct),
    tax: {
      rate: numOr(savedTax.rate, d.tax.rate),
      label: typeof savedTax.label === "string" && savedTax.label.trim() ? savedTax.label : d.tax.label,
      basis: savedTax.basis === "price" ? "price" : "price_plus_docfee",
    },
    productWeights,
    targets: {
      deliveredUnits: numOr(savedTargets.deliveredUnits, d.targets.deliveredUnits),
      pvrTotal: numOr(savedTargets.pvrTotal, d.targets.pvrTotal),
      frontEnd: numOr(savedTargets.frontEnd, d.targets.frontEnd),
      backEnd: numOr(savedTargets.backEnd, d.targets.backEnd),
      ppuMinimum: numOr(savedTargets.ppuMinimum, d.targets.ppuMinimum),
      ppuElite: numOr(savedTargets.ppuElite, d.targets.ppuElite),
    },
    aiAssistantEnabled: saved.aiAssistantEnabled === false ? false : true,
    // Pass through the org's pay-cycle/vocabulary if saved, else the defaults.
    payCycle: saved.payCycle ?? d.payCycle,
    vocab: saved.vocab ?? d.vocab,
    // Per-store deal-jacket order: keep only real strings; empty = unset so
    // readers fall back to the house default.
    dealJacketOrder: Array.isArray(saved.dealJacketOrder)
      ? saved.dealJacketOrder.filter((s): s is string => typeof s === "string" && Boolean(s.trim())).map((s) => s.trim())
      : undefined,
  };
}

// Tax estimate for a taxable base (selling price). Doc fee is added to the base
// when the rule says so (GA TAVT is on price + doc fee). No tax engine yet —
// this is a single-rate helper; per-state methods come later.
export function estimatedTax(price: number, settings: StoreSettings = activeStoreSettings) {
  const base = settings.tax.basis === "price_plus_docfee" ? price + settings.docFee : price;
  return Math.max(base, 0) * settings.tax.rate;
}

export const team: TeamMember[] = [
  { name: "Noel Bernard", role: "Sales", title: "Sales Consultant", rank: "Sales Consultant", mission: "Drive trust, urgency, and consistency.", phone: "404-781-7011", email: "nbernard@kennesawmazda.com", employeeNumber: "158", unitGoal: 16 },
  { name: "Watson Jones", role: "Sales", title: "Sales Consultant", rank: "Sales Consultant", mission: "Own every follow-up with precision.", phone: "404-819-9703", email: "wjones@kennesawmazda.com", employeeNumber: "133", unitGoal: 15 },
  { name: "Shawn Smith", role: "Sales", title: "Sales Consultant", rank: "Sales Consultant", mission: "Turn every lead into a next step.", phone: "470-343-9174", email: "ssmith@kennesawmazda.com", employeeNumber: "175", unitGoal: 18 },
  { name: "Daniel Maharaj", role: "Sales", title: "Sales Consultant", rank: "Sales Consultant", mission: "Convert showroom energy into delivered units.", phone: "404-441-6904", email: "dmaharaj@kennesawmazda.com", employeeNumber: "181", unitGoal: 12 },
  { name: "Joseph Sotis", role: "Sales", title: "Sales Consultant", rank: "Sales Consultant", mission: "Create momentum on every opportunity.", phone: "843-443-6281", email: "jsotis@kennesawmazda.com", employeeNumber: "190", unitGoal: 13 },
  { name: "Anthony Williams II", role: "Sales", title: "Sales Consultant", rank: "Sales Consultant", mission: "Protect the customer experience and execute clean follow-up.", phone: "470-437-6831", email: "awilliams@kennesawmazda.com", employeeNumber: "145", unitGoal: 18 },
  { name: "Gregory Townsend", role: "Sales", title: "Sales Consultant", rank: "Sales Consultant", mission: "Protect gross without losing pace.", phone: "678-882-6828", email: "gtownsend@kennesawmazda.com", employeeNumber: "147", unitGoal: 13 },
  { name: "Rick Brown", role: "Sales", title: "Product Specialist", rank: "Product Specialist", mission: "Keep the desk fed with clean deals.", phone: "770-616-3839", email: "rbrown@kennesawmazda.com", employeeNumber: "178", unitGoal: 15 },
  { name: "Shaun Houston", role: "Sales", title: "Product Specialist", rank: "Product Specialist", mission: "Stay sharp on process and presentation.", phone: "678-346-1542", email: "shouston@kennesawmazda.com", employeeNumber: "191", unitGoal: 5 },
  { name: "Joshua Aarons", role: "Sales", title: "Product Specialist", rank: "Product Specialist", mission: "Win the appointment before the visit.", phone: "770-543-8493", email: "jaarons@kennesawmazda.com", employeeNumber: "177", unitGoal: 18 },
  { name: "Maged Mroushdi", role: "Sales", title: "Product Specialist", rank: "Product Specialist", mission: "Make every customer feel guided.", phone: "706-295-8844", email: "mmroushdi@kennesawmazda.com", employeeNumber: "193", unitGoal: 5 },
  { name: "El", role: "Sales", title: "Product Specialist", rank: "Product Specialist", mission: "Follow the mission until delivery.", phone: "", email: "", unitGoal: 5 },
  { name: "Zee Caradine", role: "BDC", title: "BDC Representative", rank: "BDC Representative", mission: "Create the appointments that fuel the store.", phone: "404-917-9468", email: "zcaradine@kennesawmazda.com", employeeNumber: "171" },
  { name: "Aaron Price", role: "F&I", title: "Finance Manager", rank: "Finance Manager", mission: "Protect product value and customer clarity.", phone: "678-852-2165", email: "aprice@kennesawmazda.com", employeeNumber: "140" },
  { name: "Bo Tshuma", role: "F&I", title: "Finance Manager", rank: "Finance Manager", mission: "Structure clean approvals with premium execution.", phone: "404-933-0508", email: "btshuma@kennesawmazda.com", employeeNumber: "184" },
  { name: "Brunno Nakamura", role: "Manager", title: "Sales Manager", rank: "Sales Manager", mission: "Keep desk decisions fast and clean.", phone: "678-357-3509", email: "bnakamura@kennesawmazda.com", employeeNumber: "137" },
  { name: "Paul Miller", role: "Manager", title: "Pre-Owned Manager", rank: "Pre-Owned Manager", mission: "Remove friction before it slows the floor.", phone: "678-833-4671", email: "pmiller@kennesawmazda.com", employeeNumber: "136" },
  { name: "Matt Rock", role: "Manager", title: "Sales Manager", rank: "Sales Manager", mission: "Balance volume, gross, and accountability.", phone: "404-561-3098", email: "mrock@kennesawmazda.com", employeeNumber: "189" },
  { name: "Daryl NeSmith", role: "Manager", title: "General Manager", rank: "General Manager", mission: "See the whole store clearly.", phone: "404-626-0342", email: "dnesmith@kennesawmazda.com", employeeNumber: "110" },
  { name: "Carlos Mercado", role: "Service", title: "Service Manager", rank: "Service Manager", mission: "Keep service operations clear, fast, and accountable.", phone: "", email: "cmercado@kennesawmazda.com" },
  { name: "Christopher Terry", role: "Service", title: "Service Advisor", rank: "Service Advisor", mission: "Own every repair order from arrival to pickup.", phone: "", email: "cterry@kennesawmazda.com" },
  { name: "Dawn Bresko", role: "Service", title: "Service Advisor", rank: "Service Advisor", mission: "Keep customers informed and service lanes moving.", phone: "", email: "dbresko@kennesawmazda.com" },
  { name: "Stephen Velazquez", role: "Service", title: "Service Advisor", rank: "Service Advisor", mission: "Protect the service experience with clear communication.", phone: "", email: "svelazquez@kennesawmazda.com" },
  { name: "Angel Mercado", role: "Parts", title: "Parts Manager", rank: "Parts Manager", mission: "Keep parts flow accurate and ready for fixed ops.", phone: "", email: "amercado@kennesawmazda.com" },
  { name: "Reggie Moss", role: "Parts", title: "Parts Consultant", rank: "Parts Consultant", mission: "Support service, wholesale, and counter needs with precision.", phone: "", email: "rmoss@kennesawmazda.com" },
  { name: "Alejandro Torres", role: "Parts", title: "Parts Consultant", rank: "Parts Consultant", mission: "Keep parts support fast, accurate, and customer ready.", phone: "", email: "atorres@kennesawmazda.com" },
  { name: "Yoma Carter", role: "Administration", title: "Payroll/HR Admin", rank: "Payroll/HR Admin", mission: "Protect payroll, people records, and internal accuracy.", phone: "", email: "ycarter@kennesawmazda.com" },
  { name: "Tara Ray", role: "Administration", title: "Billing Clerk", rank: "Billing Clerk", mission: "Keep billing details clean and timely.", phone: "", email: "tray@kennesawmazda.com" },
  { name: "Zahra Moeingaldiani", role: "Administration", title: "Accounts Payable", rank: "Accounts Payable", mission: "Protect payables and vendor accuracy.", phone: "", email: "zmoeingaldiani@kennesawmazda.com" },
  { name: "Meloney Shirley", role: "Administration", title: "Receptionist", rank: "Receptionist", mission: "Create the first impression and route customers with care.", phone: "", email: "mshirley@kennesawmazda.com" },
  { name: "Ally Dumont", role: "Administration", title: "Receptionist", rank: "Receptionist", mission: "Support the store with a clear, welcoming front line.", phone: "", email: "adumont@kennesawmazda.com" },
  { name: "AJ Jaavaid", role: "Administration", title: "Controller", rank: "Controller", mission: "Keep the financial picture accurate and accountable.", phone: "", email: "ajaavaid@kennesawmazda.com" },
];

export const deals: Deal[] = [];

export function productUnits(deal: Deal, weights: Record<ProductKey, number> = activeStoreSettings.productWeights) {
  return Object.entries(deal.products).reduce((sum, [key, value]) => {
    return sum + (value ? (weights[key as ProductKey] ?? 0) : 0);
  }, 0);
}

export function hasProductData(deal: Deal) {
  return Object.keys(productWeights).some((key) => key in deal.products);
}

// CASH COUNTS (Aaron's rule, July 12 2026): a cash deal qualifies against
// gross, PVR, and PPU exactly like a financed one — ONLY a deal marked DNQ
// is protected out. The old Classified-only gate let cash deals (and their
// back gross and empty menus) vanish from the F&I accountability math.
export function countsTowardPpu(deal: Deal) {
  return (deal.vehicleClass === "New" || deal.vehicleClass === "Used") && deal.financeStatus !== "DNQ";
}

export function productsSold(deal: Deal) {
  return Object.entries(productLabels)
    .filter(([key]) => deal.products[key as keyof Deal["products"]])
    .map(([, label]) => label);
}

// Money that was never entered is ZERO — a partial or imported deal must
// never poison a sum into NaN and paint "$NaN" on a screen.
export const money = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function totalGross(deal: Deal) {
  return money(deal.frontGross) + money(deal.backGrossReserve) + docFeeIncome(deal);
}

export function docFeeIncome(deal: Deal, settings: StoreSettings = activeStoreSettings) {
  void settings; // signature kept for callers that pass per-store settings
  // ONLY money actually entered counts. The old fallback IMPUTED the store's
  // standard doc fee onto any deal with none recorded — fabricating income in
  // gross/PVR while the Office Check simultaneously flagged those same deals
  // for a missing doc fee. No entry = $0, and the check tells you to fix it.
  // Number.isFinite (not `typeof === "number"`): NaN is a number, so a bad
  // import with docFee=NaN would otherwise pass straight through and poison
  // totalGross/PVR even though front/back are money()-guarded.
  return Number.isFinite(deal.docFee) ? (deal.docFee as number) : 0;
}

export function commissionableFrontGross(deal: Deal) {
  return money(deal.frontGross);
}

export function parseMoneyInput(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const isParenthesesNegative = raw.startsWith("(") && raw.endsWith(")");
  const normalized = raw.replace(/[,$\s()]/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return isParenthesesNegative ? -Math.abs(parsed) : parsed;
}

export function manufacturerMoney(deal: Deal, settings: StoreSettings = activeStoreSettings) {
  if (deal.vehicleClass !== "New" || !deal.invoiceAmount) return 0;
  return deal.invoiceAmount * settings.holdbackPct;
}

export function hasTradeData(deal: Deal) {
  return Boolean(
    deal.tradeYear || deal.tradeMake || deal.tradeModel || deal.tradeVin || typeof deal.tradeAcv === "number" || typeof deal.tradePayoff === "number"
  );
}

// Customer equity in the trade at deal time = what the car is worth to the
// store (ACV) minus what is still owed on it (payoff). Positive helps the
// deal; negative is rolled into the new loan.
export function tradeEquity(deal: Deal) {
  if (typeof deal.tradeAcv !== "number" && typeof deal.tradePayoff !== "number") return 0;
  return (deal.tradeAcv ?? 0) - (deal.tradePayoff ?? 0);
}

export function tradeVehicleLabel(deal: Deal) {
  return [deal.tradeYear, deal.tradeMake, deal.tradeModel].filter(Boolean).join(" ");
}

// CASH COUNTS unless DNQ — see countsTowardPpu (Aaron's rule, July 12 2026).
export function countsTowardFinance(deal: Deal) {
  return deal.financeStatus !== "DNQ";
}

export function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function number(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function displayPersonName(name: string) {
  return displayFullPersonName(canonicalPersonName(name));
}

export function displayFullPersonName(name: string) {
  // Defensive: a missing person field on a partial/imported record renders
  // empty instead of crashing the screen (same class as normalizePersonLookup).
  return toTitleCase(String(name ?? "").trim());
}

export function findTeamMemberByName(name: string) {
  const normalized = normalizePersonLookup(name);
  if (!normalized) return undefined;

  const alias = personAliases[normalized];
  if (alias) {
    const aliasMatch = team.find((member) => normalizePersonLookup(member.name) === normalizePersonLookup(alias));
    if (aliasMatch) return aliasMatch;
  }

  return (
    team.find((member) => normalizePersonLookup(member.name) === normalized) ||
    team.find((member) => normalizePersonLookup(lastName(member.name)) === normalized) ||
    team.find((member) => normalizePersonLookup(member.name).startsWith(`${normalized} `))
  );
}

export function canonicalPersonName(name: string) {
  return findTeamMemberByName(name)?.name || displayFullPersonName(name);
}

// "House"/"unassigned" placeholders are deal buckets, not real people — they
// land in a roster (so deals can be attributed) but should NOT get their own
// performance scorecard (e.g. the F&I Report's per-manager cards).
export function isHouseBucketName(name: string) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return true;
  return /\b(house|unassigned|n\/?a)\b/.test(n);
}

export function samePerson(left: string, right: string) {
  return normalizePersonLookup(canonicalPersonName(left)) === normalizePersonLookup(canonicalPersonName(right));
}

function toTitleCase(value: string) {
  return value
    .split(/(\s+|-)/)
    .map((part) => {
      if (/^[\s-]+$/.test(part)) return part;
      if (/^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(part)) return part.toUpperCase();
      const isSingleCase = part === part.toUpperCase() || part === part.toLowerCase();
      return isSingleCase ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part;
    })
    .join("");
}

function lastName(name: string) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || name;
}

function normalizePersonLookup(name: string) {
  // Defensive: partial/imported records can carry a missing person field —
  // that's an empty lookup, never a crash for every screen rendering the list.
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

const personAliases: Record<string, string> = {
  "aaron": "Aaron Price",
  "aaron price": "Aaron Price",
  "aarons": "Joshua Aarons",
  "anthony": "Anthony Williams II",
  "anthony williams": "Anthony Williams II",
  "anthony williams ii": "Anthony Williams II",
  "bongani tshuma": "Bo Tshuma",
  "bo": "Bo Tshuma",
  "daryl nesmith": "Daryl NeSmith",
  "greg": "Gregory Townsend",
  "greg townsend": "Gregory Townsend",
  "joe": "Joseph Sotis",
  "joe sotis": "Joseph Sotis",
  "joseph": "Joseph Sotis",
  "roushdi": "Maged Mroushdi",
  "tshuma": "Bo Tshuma",
  "williams": "Anthony Williams II",
  "tony": "Anthony Williams II",
  "tony williams": "Anthony Williams II",
};

// ---------------------------------------------------------------------------
// Month pace engine (shared by Command and Scorecard so the store numbers match)
//
// The store is open Monday–Saturday and closed Sundays, so every pace and
// "per day" number is computed on SELLING days, not calendar days. Salespeople
// also each take one weekday off, but that is an individual schedule and must
// never shrink the store-level divisor, so it is not modeled here.
// ---------------------------------------------------------------------------
function isSellingDay(date: Date) {
  return date.getDay() !== 0; // 0 = Sunday (store closed)
}

function countSellingDays(year: number, month: number, fromDay: number, toDay: number) {
  let count = 0;
  for (let day = fromDay; day <= toDay; day += 1) {
    if (isSellingDay(new Date(year, month, day))) count += 1;
  }
  return count;
}

export function currentMonthPace(sourceDeals: Deal[]) {
  const dates = sourceDeals
    .map((deal) => new Date(`${deal.date}T12:00:00`))
    .filter((date) => !Number.isNaN(date.getTime()));
  const today = new Date();
  const anchor = dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : today;
  const month = anchor.getMonth();
  const year = anchor.getFullYear();
  const daysInCalendarMonth = new Date(year, month + 1, 0).getDate();
  const sameMonthToday = today.getFullYear() === year && today.getMonth() === month;
  const dayOfMonth = sameMonthToday ? today.getDate() : anchor.getDate();
  const clampedDay = Math.min(Math.max(dayOfMonth, 1), daysInCalendarMonth);

  // Today is treated as still open: a remaining selling day, not an elapsed one.
  // So elapsed + remaining partition the month with no day counted twice, and
  // the Behind/Ahead plan line reconciles exactly with the Need/Day mission.
  const daysInMonth = countSellingDays(year, month, 1, daysInCalendarMonth);
  const sellingDaysSoFar = countSellingDays(year, month, 1, clampedDay); // includes today
  const remainingDays = Math.max(countSellingDays(year, month, clampedDay, daysInCalendarMonth), 1); // includes today
  const elapsedDays = Math.max(daysInMonth - remainingDays, 0); // selling days completed before today

  return {
    elapsedDays,
    remainingDays,
    daysInMonth,
    sellingDaysSoFar,
    monthName: anchor.toLocaleString("en-US", { month: "long" }),
  };
}

// Run-rate forecast: current rate per selling day so far, projected across the
// month's selling days. Uses days-so-far (today included, since month-to-date
// totals include today's deliveries) rather than completed days.
export function paceValue(current: number, pace: ReturnType<typeof currentMonthPace>) {
  return pace.sellingDaysSoFar ? (current / pace.sellingDaysSoFar) * pace.daysInMonth : 0;
}

export function dailyNeed(goal: number, current: number, remainingDays: number) {
  return Math.max((goal - current) / remainingDays, 0);
}

// ---------------------------------------------------------------------------
// Eligibility — the single source of truth for "what is a deal".
//
// A deal counts the moment it is marked sold (Delivered or Funded). F&I
// classification (Classified / Not Classified / DNQ) NEVER removes a unit from
// a salesperson — it only governs the F&I/product side. Wholesale is an
// inventory lane, not a retail salesperson unit, so the sales and PVR math is
// built on retail (New + Used) sold deals. Every screen calls these helpers so
// the same person shows the same numbers everywhere.
// ---------------------------------------------------------------------------
export function isSold(deal: Deal) {
  return deal.stage === "Delivered" || deal.stage === "Funded";
}

// A PRODUCT-ONLY deal: backend product(s) sold to a customer with NO vehicle
// behind them (e.g. a walk-in buys a VSC / appearance package). It carries F&I
// back gross + products but no car — no stock #, no VIN, no invoice, no front
// gross. Per Aaron's rule (EILA report, July 2026 — Chris Cbotta VSC+appearance):
// its GROSS and PRODUCTS still count toward PVR and PPU, but it is NOT a vehicle
// UNIT (no car sold — hence "product only"). So it feeds the PVR/PPU numerators
// and never the unit denominators.
export function isProductOnly(deal: Deal): boolean {
  const noVehicleId = !String(deal.stockNumber || "").trim() && !String(deal.vin || "").trim();
  const noVehicleMoney = !(Number(deal.invoiceAmount) > 0) && money(deal.frontGross) <= 0;
  const hasBackend = money(deal.backGrossReserve) > 0 || Object.values(deal.products || {}).some(Boolean);
  return noVehicleId && noVehicleMoney && hasBackend;
}

// The F&I production set: New/Used deals whose gross + products count. INCLUDES
// product-only (its back gross feeds PVR, its products feed PPU).
export function isRetail(deal: Deal) {
  return deal.vehicleClass === "New" || deal.vehicleClass === "Used";
}

// The UNIT gate — a retail deal that is an actual car. Product-only deals are
// retail (gross/products count) but are NOT vehicle units.
export function isVehicleUnit(deal: Deal) {
  return isRetail(deal) && !isProductOnly(deal);
}

// How a deal's TYPE reads to the user. A product-only deal is stored as a New/Used
// class so its gross/products count toward PVR/PPU, but it must DISPLAY as
// "Product Only" — no vehicle unit is being sold.
export function dealTypeLabel(deal: Deal): string {
  return isProductOnly(deal) ? "Product Only" : deal.vehicleClass;
}

export function isCountableRetail(deal: Deal) {
  return isSold(deal) && isRetail(deal);
}

export function isCountableFinance(deal: Deal) {
  return isCountableRetail(deal) && countsTowardFinance(deal);
}

// Split-deal credit: every named seat on a deal earns an equal share, so a
// two-person split is half a unit and half the gross for each rep, and the two
// halves add back up to exactly one store unit.
export function salespersonShare(deal: Deal, name: string) {
  const seats = [deal.salesperson, deal.salesperson2].filter((seat) => seat && seat.trim());
  if (!seats.length) return 0;
  const mine = seats.filter((seat) => samePerson(seat as string, name)).length;
  return mine ? mine / seats.length : 0;
}

export type SalespersonStats = {
  units: number;
  frontGross: number;
  backGross: number;
  totalGross: number;
  products: number;
  productReadyUnits: number;
  ppu: number;
  pvr: number;
};

export function salespersonStats(sourceDeals: Deal[], name: string): SalespersonStats {
  let units = 0;
  let frontGross = 0;
  let backGross = 0;
  let products = 0;
  let productReadyUnits = 0;

  for (const deal of sourceDeals) {
    if (!isCountableRetail(deal)) continue;
    const share = salespersonShare(deal, name);
    if (!share) continue;
    // Product-only deals contribute gross + products (PVR/PPU numerators) but are
    // NOT a car unit, so they never touch the unit denominators.
    const car = isVehicleUnit(deal);
    if (car) units += share;
    frontGross += commissionableFrontGross(deal) * share;
    backGross += money(deal.backGrossReserve) * share;
    if (countsTowardPpu(deal)) {
      if (car) productReadyUnits += share;
      products += productUnits(deal) * share;
    }
  }

  const totalGross = frontGross + backGross;
  return {
    units,
    frontGross,
    backGross,
    totalGross,
    products,
    productReadyUnits,
    ppu: productReadyUnits ? products / productReadyUnits : 0,
    pvr: units ? totalGross / units : 0,
  };
}

export type FinanceStats = {
  copies: number;
  backGross: number;
  products: number;
  ppu: number;
  pvr: number;
};

export function financeStats(sourceDeals: Deal[], name: string): FinanceStats {
  const mine = sourceDeals.filter((deal) => isCountableFinance(deal) && samePerson(deal.financeManager, name));
  const copies = mine.length;
  const backGross = mine.reduce((sum, deal) => sum + money(deal.backGrossReserve), 0);
  const products = mine.reduce((sum, deal) => sum + productUnits(deal), 0);
  return {
    copies,
    backGross,
    products,
    ppu: copies ? products / copies : 0,
    pvr: copies ? backGross / copies : 0,
  };
}

export type FinanceManagerStats = {
  deals: number; // every retail deal the FM closed — finance, cash AND DNQ
  financeDeals: number; // the subset that count toward F&I penetration
  backGross: number; // back gross across ALL their deals (cash deals included)
  products: number;
  ppu: number;
  pvr: number; // back gross per deal — matches the DMS F&I Manager log
};

// The F&I manager's full production. Unlike financeStats (finance-only, for
// penetration), this counts back gross on cash/DNQ deals too — a manager still
// earns that back end, and the dealer's FM log reports it. PVR = back / deals.
export function financeManagerStats(sourceDeals: Deal[], name: string): FinanceManagerStats {
  const mine = sourceDeals.filter((deal) => isCountableRetail(deal) && samePerson(deal.financeManager, name));
  const deals = mine.length;
  const backGross = mine.reduce((sum, deal) => sum + money(deal.backGrossReserve), 0);
  const products = mine.reduce((sum, deal) => sum + productUnits(deal), 0);
  return {
    deals,
    financeDeals: mine.filter(countsTowardFinance).length,
    backGross,
    products,
    ppu: deals ? products / deals : 0,
    pvr: deals ? backGross / deals : 0,
  };
}

export function financeManagerBoard(sourceDeals: Deal[], names: string[]) {
  return names
    .map((name) => ({ name, ...financeManagerStats(sourceDeals, name) }))
    .sort((a, b) => b.deals - a.deals || b.backGross - a.backGross || a.name.localeCompare(b.name));
}

// Distinct canonical names that appear on the deals, so leader boards on
// screens without the team-list hook still merge name variants correctly.
export function salespersonNamesFromDeals(sourceDeals: Deal[]) {
  const names = new Set<string>();
  sourceDeals.forEach((deal) => {
    [deal.salesperson, deal.salesperson2].forEach((seat) => {
      if (seat && seat.trim()) names.add(canonicalPersonName(seat));
    });
  });
  return [...names];
}

export function financeManagerNamesFromDeals(sourceDeals: Deal[]) {
  const names = new Set<string>();
  sourceDeals.forEach((deal) => {
    if (deal.financeManager && deal.financeManager.trim()) names.add(canonicalPersonName(deal.financeManager));
  });
  return [...names];
}

export function salesLeaderboard(sourceDeals: Deal[], names: string[]) {
  return names
    .map((name) => ({ name, ...salespersonStats(sourceDeals, name) }))
    .sort((a, b) => b.units - a.units || b.totalGross - a.totalGross || a.name.localeCompare(b.name));
}

export function financeLeaderboard(sourceDeals: Deal[], names: string[]) {
  return names
    .map((name) => ({ name, ...financeStats(sourceDeals, name) }))
    .sort((a, b) => b.copies - a.copies || b.backGross - a.backGross || a.name.localeCompare(b.name));
}

// Format a (possibly fractional, from splits) unit count: whole numbers stay
// clean, splits show a single decimal.
export function unitsLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function metricsFor(sourceDeals = deals) {
  const sold = sourceDeals.filter(isSold); // all classes, used only for class breakdown
  const retail = sold.filter(isRetail); // F&I production set — gross + products (INCLUDES product-only)
  const vehicleUnits = retail.filter(isVehicleUnit); // actual cars — the unit denominators
  const delivered = vehicleUnits.length; // units = cars only (product-only is not a unit)
  // Gross sums are over `retail`, so a product-only deal's back gross DOES count
  // toward PVR — divided by car units below, exactly per Aaron's rule.
  const gross = retail.reduce((sum, deal) => sum + totalGross(deal), 0);
  const front = retail.reduce((sum, deal) => sum + money(deal.frontGross), 0);
  const back = retail.reduce((sum, deal) => sum + money(deal.backGrossReserve), 0);
  const docFees = retail.reduce((sum, deal) => sum + docFeeIncome(deal), 0);
  const ppuDeals = retail.filter(countsTowardPpu); // product NUMERATOR source (incl product-only)
  const productTotal = ppuDeals.reduce((sum, deal) => sum + productUnits(deal), 0);
  const ppuUnits = ppuDeals.filter(isVehicleUnit); // PPU DENOMINATOR — product-ready cars
  const classified = retail.filter(countsTowardFinance);
  const financeGross = classified.reduce((sum, deal) => sum + money(deal.backGrossReserve), 0);
  // Class breakdown counts cars only — a product-only deal tagged New/Used can't
  // inflate the unit count.
  const newUnits = vehicleUnits.filter((deal) => deal.vehicleClass === "New").length;
  const usedUnits = vehicleUnits.filter((deal) => deal.vehicleClass === "Used").length;
  const wholesaleUnits = sold.filter((deal) => deal.vehicleClass === "Wholesale").length;
  const opportunityRadar = sourceDeals.filter((deal) => deal.stage === "Desk" || deal.stage === "Contracted").length;
  const productCaptured = ppuUnits.filter(hasProductData).length;
  const eliteDeals = ppuUnits.filter((deal) => productUnits(deal) >= goals.ppuElite).length;

  return {
    delivered,
    gross,
    front,
    back,
    docFees,
    pvr: delivered ? gross / delivered : 0,
    frontPvr: delivered ? front / delivered : 0,
    backPvr: delivered ? back / delivered : 0,
    ppu: ppuUnits.length ? productTotal / ppuUnits.length : 0,
    productTotal,
    productReady: ppuUnits.length,
    productCaptured,
    productMissing: ppuUnits.length - productCaptured,
    classified: classified.length,
    financeGross,
    financePvr: classified.length ? financeGross / classified.length : 0,
    newUnits,
    usedUnits,
    wholesaleUnits,
    missionVelocity: Math.round((delivered / goals.deliveredUnits) * 100),
    eliteIndex: ppuUnits.length ? Math.round((eliteDeals / ppuUnits.length) * 100) : 0,
    opportunityRadar,
  };
}
