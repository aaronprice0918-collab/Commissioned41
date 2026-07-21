// Service Drive v1 (Module 17) — the lane board brain. The biggest revenue
// surface the OS didn't touch, and the data source the equity radar has been
// waiting for. One appointment record, one status lane, one rule: the four-
// part test — this exists to keep the lane MOVING (time), catch every
// declined-work dollar (profit), show who's stuck (accountability), and keep
// the customer told (experience).
//
// Storage: org-scoped `serviceLane` app_store key (an array of visits) — the
// same JSONB pattern as leads/deals. REMEMBER THE RULE: a new store key needs
// BOTH allowedKeys (route) and a canWrite rule (lib/access.ts).

export type ServiceStatus = "Scheduled" | "Checked In" | "In Service" | "Ready" | "Picked Up";

export const SERVICE_STATUSES: ServiceStatus[] = ["Scheduled", "Checked In", "In Service", "Ready", "Picked Up"];

export type ServiceVisit = {
  id: string; // SVC-<ms>
  createdAt: string; // ISO
  customer: string;
  customerPhone: string;
  vehicle: string; // year make model
  vin?: string;
  mileage?: number;
  concern: string; // what they came in for, customer's words
  advisor: string;
  promisedAt?: string; // datetime-local — when we said it'd be done
  status: ServiceStatus;
  statusHistory: { status: ServiceStatus; at: string }[];
  // The money story: RO total when written, declined work captured verbatim
  // (tomorrow's re-contact list — real profit sitting in notes today).
  roNumber?: string;
  estimatedTotal?: number;
  declinedWork?: string;
  notes?: string;
  // Sales hook: the advisor flags a service customer worth a trade
  // conversation — the equity radar's missing feed, one tap.
  salesOpportunity?: boolean;
  // Promise-Time Guardian: when the customer last heard from us (stamped by
  // the "Status text" copy on the card). The #1 CSI complaint industry-wide
  // is silence — this field makes silence visible.
  lastUpdateAt?: string;
  // Declined-Work Recapture: the mission state on a closed visit that left
  // money on the table. Absent = still open; won back or let go otherwise.
  recapture?: { state: "recovered" | "dismissed"; at: string };
};

export function makeServiceVisit(overrides: Partial<ServiceVisit> = {}): ServiceVisit {
  const now = new Date().toISOString();
  return {
    id: `SVC-${Date.now()}`,
    createdAt: now,
    customer: "",
    customerPhone: "",
    vehicle: "",
    concern: "",
    advisor: "",
    status: "Scheduled",
    statusHistory: [{ status: "Scheduled", at: now }],
    ...overrides,
  };
}

// Advance (or move) a visit — append-only history, same discipline as leads.
export function moveVisitPatch(visit: ServiceVisit, status: ServiceStatus): Partial<ServiceVisit> | null {
  if (visit.status === status) return null;
  return { status, statusHistory: [...(visit.statusHistory || []), { status, at: new Date().toISOString() }] };
}

export function nextStatus(status: ServiceStatus): ServiceStatus | null {
  const i = SERVICE_STATUSES.indexOf(status);
  return i >= 0 && i + 1 < SERVICE_STATUSES.length ? SERVICE_STATUSES[i + 1] : null;
}

// Is the promise time blown? (Ready/Picked Up visits are done — no longer late.)
export function isLate(visit: Pick<ServiceVisit, "promisedAt" | "status">, now = new Date()): boolean {
  if (!visit.promisedAt || visit.status === "Ready" || visit.status === "Picked Up") return false;
  const t = new Date(visit.promisedAt).getTime();
  return Number.isFinite(t) && t < now.getTime();
}

const DAY_MS = 86_400_000;

export type LaneStats = {
  inLaneNow: number; // physically HERE: checked in / in service / ready. A
  // scheduled car is booked, not in the lane — the label must mean what a
  // human standing in the drive would count.
  scheduledNow: number; // booked, not arrived yet
  readyNow: number;
  lateNow: number;
  arrivedToday: number; // cars that actually landed today (local day)
  declinedOpen: number; // picked-up visits (last 30 days) with declined work captured
  salesFlags: number; // open sales-opportunity flags
};

// When did this car actually arrive? The Checked In stamp when we have it;
// hand-entered rows without one fall back to creation IF the car is past
// Scheduled (it's here, we just don't know the minute).
export function arrivedAt(visit: Pick<ServiceVisit, "status" | "statusHistory" | "createdAt">): string | null {
  const stamp = (visit.statusHistory || []).find((h) => h.status === "Checked In")?.at;
  if (stamp) return stamp;
  return visit.status !== "Scheduled" ? visit.createdAt : null;
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── Promise-Time Guardian ────────────────────────────────────────────────────
// The Guardian's whole job: nobody finds out a promise blew AFTER the
// customer does. "soon" fires inside the warning window so the advisor can
// re-promise BEFORE the clock runs out; "late" means it already did.

export const PROMISE_WARN_MINUTES = 45;

export function promiseRisk(
  visit: Pick<ServiceVisit, "promisedAt" | "status">,
  now = new Date(),
  warnMinutes = PROMISE_WARN_MINUTES,
): "late" | "soon" | null {
  if (!visit.promisedAt || visit.status === "Ready" || visit.status === "Picked Up") return null;
  const t = new Date(visit.promisedAt).getTime();
  if (!Number.isFinite(t)) return null;
  if (t < now.getTime()) return "late";
  if (t - now.getTime() <= warnMinutes * 60_000) return "soon";
  return null;
}

export const UPDATE_QUIET_HOURS = 2;

// A customer who's been here N hours without a word from us is a CSI hit in
// the making. Baseline = the last status text sent, else the moment the car
// actually arrived. Scheduled cars haven't arrived; Ready/Picked Up have
// their own call-now urgency.
export function updateDue(
  visit: Pick<ServiceVisit, "status" | "statusHistory" | "lastUpdateAt" | "createdAt">,
  now = new Date(),
  quietHours = UPDATE_QUIET_HOURS,
): boolean {
  if (visit.status !== "Checked In" && visit.status !== "In Service") return false;
  const arrived = (visit.statusHistory || []).find((h) => h.status === "Checked In")?.at || visit.createdAt;
  const baseline = visit.lastUpdateAt && visit.lastUpdateAt > arrived ? visit.lastUpdateAt : arrived;
  const t = new Date(baseline).getTime();
  return Number.isFinite(t) && now.getTime() - t >= quietHours * 3_600_000;
}

// The status text, drafted. Honest when late (re-promise, no excuses), plain
// when on track. (When it rides the real SMS pipe the pipe adds the opt-out.)
export function statusUpdateText(visit: ServiceVisit, storeName: string, now = new Date()): string {
  const first = (visit.customer || "").trim().split(/\s+/)[0] || "there";
  const vehicle = visit.vehicle || "your vehicle";
  const risk = promiseRisk(visit, now);
  if (visit.status === "Ready") {
    return `Hi ${first}, it's ${storeName} — ${vehicle} is done and ready for pickup. See you whenever works today.`;
  }
  if (risk === "late") {
    return `Hi ${first}, it's ${storeName} with an honest update on ${vehicle} — it's taking longer than we promised and I'm sorry about that. I'm watching it personally and will text you a firm time within the hour.`;
  }
  const promised = visit.promisedAt
    ? ` We're still on track for ${new Date(visit.promisedAt).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}.`
    : "";
  return `Hi ${first}, it's ${storeName} — quick update: ${vehicle} is ${visit.status === "In Service" ? "in the shop being worked on now" : "checked in and in line"}.${promised} I'll keep you posted.`;
}

// Per-advisor promise honesty over a window: of the closed visits that
// carried a promise, how many were done ON TIME? Done = first Ready (or
// Picked Up when it never showed Ready).
export type PromiseStats = { advisor: string; promised: number; kept: number; hitRate: number };

export function promiseStats(visits: ServiceVisit[], now = new Date(), windowDays = 30): PromiseStats[] {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const byAdvisor = new Map<string, { promised: number; kept: number }>();
  for (const v of visits) {
    if (!v.promisedAt || (v.status !== "Ready" && v.status !== "Picked Up")) continue;
    if (new Date(v.createdAt).getTime() < cutoff) continue;
    const doneAt = (v.statusHistory || []).find((h) => h.status === "Ready")?.at
      || (v.statusHistory || []).find((h) => h.status === "Picked Up")?.at;
    if (!doneAt) continue;
    const key = v.advisor || "(no advisor)";
    const entry = byAdvisor.get(key) || { promised: 0, kept: 0 };
    entry.promised += 1;
    if (new Date(doneAt).getTime() <= new Date(v.promisedAt).getTime()) entry.kept += 1;
    byAdvisor.set(key, entry);
  }
  return Array.from(byAdvisor.entries())
    .map(([advisor, e]) => ({ advisor, ...e, hitRate: e.promised ? Math.round((e.kept / e.promised) * 100) : 0 }))
    .sort((a, b) => b.promised - a.promised);
}

// ── Declined-Work Recapture ──────────────────────────────────────────────────
// 23-30% of declined revenue comes back with a structured cadence; ~0% comes
// back without one. Every closed visit with declined work is an open mission
// until somebody recovers it or dismisses it — nobody-owns-the-loop is the
// documented industry failure, so the loop has an owner: this list.

export type RecaptureMission = {
  visit: ServiceVisit;
  daysSince: number; // since pickup (falls back to creation)
  cadence: 30 | 60 | 90 | null; // which follow-up window it's sitting in
};

export function recaptureList(visits: ServiceVisit[], now = new Date()): RecaptureMission[] {
  const missions: RecaptureMission[] = [];
  for (const v of visits) {
    if (v.status !== "Picked Up" || !(v.declinedWork || "").trim() || v.recapture) continue;
    const pickedUpAt = (v.statusHistory || []).find((h) => h.status === "Picked Up")?.at || v.createdAt;
    const t = new Date(pickedUpAt).getTime();
    if (!Number.isFinite(t)) continue;
    const daysSince = Math.floor(Math.max(0, now.getTime() - t) / DAY_MS);
    const cadence = daysSince >= 90 ? 90 : daysSince >= 60 ? 60 : daysSince >= 30 ? 30 : null;
    missions.push({ visit: v, daysSince, cadence });
  }
  return missions.sort((a, b) => b.daysSince - a.daysSince);
}

export function recaptureText(visit: ServiceVisit, storeName: string): string {
  const first = (visit.customer || "").trim().split(/\s+/)[0] || "there";
  const vehicle = visit.vehicle || "your vehicle";
  const work = (visit.declinedWork || "").trim() || "the work we talked about";
  return `Hi ${first}, it's the service team at ${storeName}. When ${vehicle} was in, we noted: ${work}. No pressure — just checking in, since it's the kind of thing that gets pricier the longer it waits. Want me to get you a time this week?`;
}

export function laneStats(visits: ServiceVisit[], now = new Date()): LaneStats {
  const today = localDay(now);
  const cutoff = now.getTime() - 30 * DAY_MS;
  const open = visits.filter((v) => v.status !== "Picked Up");
  return {
    inLaneNow: open.filter((v) => v.status !== "Scheduled").length,
    scheduledNow: open.filter((v) => v.status === "Scheduled").length,
    readyNow: visits.filter((v) => v.status === "Ready").length,
    lateNow: visits.filter((v) => isLate(v, now)).length,
    arrivedToday: visits.filter((v) => {
      const at = arrivedAt(v);
      return at != null && localDay(new Date(at)) === today;
    }).length,
    declinedOpen: visits.filter(
      (v) => v.status === "Picked Up" && (v.declinedWork || "").trim() && !v.recapture && new Date(v.createdAt).getTime() >= cutoff,
    ).length,
    salesFlags: visits.filter((v) => v.salesOpportunity && v.status !== "Picked Up").length,
  };
}
