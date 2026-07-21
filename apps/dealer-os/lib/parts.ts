// Parts Counter v1 (Module 18) — the counter brain. Three fights the research
// says every parts department is losing, all winnable with zero DMS
// integration (see docs/FIXED-OPS-ROADMAP.md):
//   1. SOP Mission Control — special-order parts are the #1 cash leak (~95%
//      of obsolescence traces to unfulfilled demand; an unclaimed SOP is
//      worth ~40 cents on the dollar). Every SOP gets an owner and a clock.
//   2. Tech request queue — techs lose 20-50 min/day standing at the counter;
//      request-to-fill time becomes a measured number.
//   3. Lost-sale one-tap — fill rate is fiction when nobody logs the "didn't
//      have it"; three asks in ninety days = stock it.
//
// Storage: org-scoped `partsCounter` app_store key. REMEMBER THE RULE: a new
// store key needs BOTH allowedKeys (route) and a canWrite rule (lib/access.ts).

export type SopStatus = "Ordered" | "Received" | "Notified" | "Picked Up" | "Returned";

// The happy path, in lane order. "Returned" is the off-ramp (never auto-next):
// the part went back to the vendor instead of into a customer's hands.
export const SOP_STATUSES: SopStatus[] = ["Ordered", "Received", "Notified", "Picked Up", "Returned"];

export type SpecialOrder = {
  id: string; // SOP-<ms>
  createdAt: string; // ISO — when it was ordered
  customer: string;
  customerPhone: string;
  partNumber: string;
  description: string;
  // The ties that make the loop OWNED: who wrote it, which RO it belongs to.
  counterperson?: string;
  roNumber?: string;
  bin?: string; // where it's staged once received
  price?: number;
  deposit?: number; // prepay discipline — the industry's own #1 defense
  status: SopStatus;
  statusHistory: { status: SopStatus; at: string }[];
  receivedAt?: string; // stamped on the move to Received — the AGING CLOCK starts here
  notifiedAt?: string; // stamped on the move to Notified
  notes?: string;
};

export type RequestStatus = "Waiting" | "Pulled" | "Delivered";

export const REQUEST_STATUSES: RequestStatus[] = ["Waiting", "Pulled", "Delivered"];

export type PartsRequest = {
  id: string; // REQ-<ms>
  createdAt: string;
  tech: string;
  roNumber: string;
  description: string; // part number or plain words — whatever the tech has
  status: RequestStatus;
  statusHistory: { status: RequestStatus; at: string }[];
  pulledAt?: string; // request-to-fill clock stops here
};

export type LostSaleChannel = "Retail" | "Shop" | "Phone" | "Wholesale";

export type LostSale = {
  id: string; // LS-<ms>
  at: string; // ISO
  partNumber?: string;
  description: string;
  channel: LostSaleChannel;
  value?: number; // the sale that walked
  by?: string;
};

export type PartsCounterData = {
  sops: SpecialOrder[];
  requests: PartsRequest[];
  lostSales: LostSale[];
};

// One-tap logging can fire twice in the same millisecond — a counter suffix
// keeps ids unique where the service lane's plain Date.now() id could collide.
let idCounter = 0;
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${(idCounter = (idCounter + 1) % 1000)}`;

export function normalizePartsData(raw: unknown): PartsCounterData {
  const data = (raw && typeof raw === "object" ? raw : {}) as Partial<PartsCounterData>;
  return {
    sops: Array.isArray(data.sops) ? data.sops : [],
    requests: Array.isArray(data.requests) ? data.requests : [],
    lostSales: Array.isArray(data.lostSales) ? data.lostSales : [],
  };
}

export function makeSpecialOrder(overrides: Partial<SpecialOrder> = {}): SpecialOrder {
  const now = new Date().toISOString();
  return {
    id: makeId("SOP"),
    createdAt: now,
    customer: "",
    customerPhone: "",
    partNumber: "",
    description: "",
    status: "Ordered",
    statusHistory: [{ status: "Ordered", at: now }],
    ...overrides,
  };
}

export function makePartsRequest(overrides: Partial<PartsRequest> = {}): PartsRequest {
  const now = new Date().toISOString();
  return {
    id: makeId("REQ"),
    createdAt: now,
    tech: "",
    roNumber: "",
    description: "",
    status: "Waiting",
    statusHistory: [{ status: "Waiting", at: now }],
    ...overrides,
  };
}

export function makeLostSale(overrides: Partial<LostSale> = {}): LostSale {
  return {
    id: makeId("LS"),
    at: new Date().toISOString(),
    description: "",
    channel: "Retail",
    ...overrides,
  };
}

// Advance a special order — append-only history, receipt/notify stamped ONCE
// (a re-visit through a status never rewinds the aging clock).
export function moveSopPatch(sop: SpecialOrder, status: SopStatus): Partial<SpecialOrder> | null {
  if (sop.status === status) return null;
  const at = new Date().toISOString();
  return {
    status,
    statusHistory: [...(sop.statusHistory || []), { status, at }],
    ...(status === "Received" && !sop.receivedAt ? { receivedAt: at } : {}),
    ...(status === "Notified" && !sop.notifiedAt ? { notifiedAt: at } : {}),
  };
}

export function nextSopStatus(status: SopStatus): SopStatus | null {
  // Returned is an off-ramp, never the suggested next move.
  const lane: SopStatus[] = ["Ordered", "Received", "Notified", "Picked Up"];
  const i = lane.indexOf(status);
  return i >= 0 && i + 1 < lane.length ? lane[i + 1] : null;
}

export function moveRequestPatch(request: PartsRequest, status: RequestStatus): Partial<PartsRequest> | null {
  if (request.status === status) return null;
  const at = new Date().toISOString();
  return {
    status,
    statusHistory: [...(request.statusHistory || []), { status, at }],
    ...(status === "Pulled" && !request.pulledAt ? { pulledAt: at } : {}),
  };
}

export function nextRequestStatus(status: RequestStatus): RequestStatus | null {
  const i = REQUEST_STATUSES.indexOf(status);
  return i >= 0 && i + 1 < REQUEST_STATUSES.length ? REQUEST_STATUSES[i + 1] : null;
}

const DAY_MS = 86_400_000;

export const sopOpen = (sop: Pick<SpecialOrder, "status">) => sop.status !== "Picked Up" && sop.status !== "Returned";

// The aging clock: days the part has been SITTING HERE (since receipt — the
// industry counts aging from the day it hit the shelf, not the day it was
// ordered). Ordered-not-arrived and closed SOPs don't age.
export function sopAgeDays(sop: Pick<SpecialOrder, "status" | "receivedAt">, now = new Date()): number | null {
  if (!sop.receivedAt || !sopOpen(sop)) return null;
  const t = new Date(sop.receivedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor(Math.max(0, now.getTime() - t) / DAY_MS);
}

// The escalation ladder from the roadmap: nudge at 7, escalate at 14, GM digest at 30.
export const SOP_AGING_DAYS = 7;

export function requestFillMinutes(request: Pick<PartsRequest, "createdAt" | "pulledAt">): number | null {
  if (!request.pulledAt) return null;
  const start = new Date(request.createdAt).getTime();
  const end = new Date(request.pulledAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}

// The pickup text the Notify move offers to send/copy. Plain words, the
// customer's name, what landed, where to come. (When it rides the real SMS
// pipe, the pipe adds the opt-out line — same rule as every outbound.)
export function sopPickupText(sop: SpecialOrder, storeName: string): string {
  const first = (sop.customer || "").trim().split(/\s+/)[0] || "there";
  const part = sop.description || sop.partNumber || "your part";
  return `Hi ${first}, it's the parts department at ${storeName} — good news, ${part} just arrived. Come by any time and we'll take care of you.${sop.deposit ? " Your deposit is already on the ticket." : ""}`;
}

const normalizePartKey = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export type StockSuggestion = { key: string; label: string; demands: number; lastAsked: string; value: number };

// Three asks in ninety days = the phase-in bell. Grouped by part number when
// we have one, by the words otherwise.
export function stockSuggestions(lostSales: LostSale[], now = new Date(), minDemands = 3, windowDays = 90): StockSuggestion[] {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const groups = new Map<string, { label: string; demands: number; lastAsked: string; value: number }>();
  for (const sale of lostSales) {
    const t = new Date(sale.at).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const key = normalizePartKey(sale.partNumber || "") || normalizePartKey(sale.description);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.demands += 1;
      existing.value += sale.value || 0;
      if (sale.at > existing.lastAsked) existing.lastAsked = sale.at;
    } else {
      groups.set(key, { label: sale.partNumber || sale.description, demands: 1, lastAsked: sale.at, value: sale.value || 0 });
    }
  }
  return Array.from(groups.entries())
    .filter(([, g]) => g.demands >= minDemands)
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => b.demands - a.demands || b.value - a.value);
}

export type CounterStats = {
  sopsOrdered: number; // ordered, not landed yet
  sopsWaiting: number; // received/notified — sitting on the shelf
  sopsAging: number; // waiting AND >= SOP_AGING_DAYS days since receipt
  sopsWaitingValue: number; // dollars sitting in the SOP bins
  queueWaiting: number; // techs waiting right now
  avgFillMinutes: number | null; // request-to-fill, last 30 days
  lostSales30d: number;
  lostValue30d: number;
  suggestions: number; // stock-it candidates
};

export function counterStats(data: PartsCounterData, now = new Date()): CounterStats {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const waiting = data.sops.filter((s) => s.status === "Received" || s.status === "Notified");
  const fills = data.requests
    .map((r) => ({ r, minutes: requestFillMinutes(r) }))
    .filter((x): x is { r: PartsRequest; minutes: number } => x.minutes != null && new Date(x.r.createdAt).getTime() >= cutoff);
  const lost30 = data.lostSales.filter((l) => new Date(l.at).getTime() >= cutoff);
  return {
    sopsOrdered: data.sops.filter((s) => s.status === "Ordered").length,
    sopsWaiting: waiting.length,
    sopsAging: waiting.filter((s) => (sopAgeDays(s, now) ?? 0) >= SOP_AGING_DAYS).length,
    sopsWaitingValue: waiting.reduce((sum, s) => sum + (s.price || 0), 0),
    queueWaiting: data.requests.filter((r) => r.status === "Waiting").length,
    avgFillMinutes: fills.length ? Math.round(fills.reduce((sum, x) => sum + x.minutes, 0) / fills.length) : null,
    lostSales30d: lost30.length,
    lostValue30d: lost30.reduce((sum, l) => sum + (l.value || 0), 0),
    suggestions: stockSuggestions(data.lostSales, now).length,
  };
}
