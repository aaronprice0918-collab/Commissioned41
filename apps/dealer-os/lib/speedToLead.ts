import type { CrmLead } from "@/components/CrmProvider";

// ── The Five-Minute Response System (VISION module 5) ───────────────────────
// Speed-to-lead is the industry's agreed baseline (July 2026 competitive
// research, docs/COMPETITIVE-GAPS-2026-07.md): a fresh lead answered inside
// five minutes converts; one that sits goes cold. This module is the one
// brain: every New Lead runs a visible 5:00 clock from the moment it lands,
// a lead that blows the clock escalates (red, top of the list, EILA calls it
// out), and the store is graded on the month's % answered under five.
//
// "First contact" is captured, not claimed: tapping the lead's phone/email
// link, or moving the lead past New Lead, stamps firstContactAt. Legacy leads
// without the stamp fall back to their first non-New statusHistory entry.

export const FIVE_MINUTES_MS = 5 * 60 * 1000;
// Only recent history counts toward the grade — a stale imported lead that
// nobody ever touched shouldn't poison this month's number forever.
export const STATS_WINDOW_DAYS = 30;

export type SpeedClockState =
  // Fresh New Lead, inside 5:00 — the clock is running.
  | { state: "on_clock"; secondsLeft: number; createdAt: string }
  // New Lead past 5:00 with no contact — escalated.
  | { state: "breached"; minutesOver: number; createdAt: string }
  // First contact happened; how fast (null when the moment wasn't captured).
  | { state: "responded"; responseMinutes: number | null; createdAt: string }
  // No usable creation time (pre-dates the system) — not graded.
  | { state: "not_applicable" };

/** When the lead landed: the `date` field, else the CRM-<ms> id timestamp. */
export function leadCreatedAt(lead: Pick<CrmLead, "id" | "date">): string | null {
  if (lead.date) {
    const t = new Date(lead.date).getTime();
    if (Number.isFinite(t) && t > 0) return new Date(t).toISOString();
  }
  const m = /^CRM-(\d{12,})$/.exec(lead.id || "");
  if (m) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t > 0) return new Date(t).toISOString();
  }
  return null;
}

/** When the lead was first contacted: the explicit stamp, else the first
 * status move past New Lead (legacy fallback). Marking a lead LOST is not
 * contact — killing a junk lead two minutes in must never grade as
 * "answered in 2 minutes" and inflate the store's under-5 percentage. */
export function firstContactTime(
  lead: Pick<CrmLead, "firstContactAt" | "statusHistory" | "status">,
): string | null {
  if (lead.firstContactAt) return lead.firstContactAt;
  const moved = (lead.statusHistory || []).find((h) => h.status !== "New Lead" && h.status !== "Lost");
  return moved?.at ?? null;
}

export function speedClock(
  lead: Pick<CrmLead, "id" | "date" | "status" | "firstContactAt" | "statusHistory">,
  now = new Date(),
): SpeedClockState {
  const createdAt = leadCreatedAt(lead);
  if (!createdAt) return { state: "not_applicable" };
  const created = new Date(createdAt).getTime();

  const contact = firstContactTime(lead);
  if (contact) {
    const at = new Date(contact).getTime();
    const mins = Number.isFinite(at) && at >= created ? (at - created) / 60000 : null;
    return { state: "responded", responseMinutes: mins === null ? null : Math.round(mins * 10) / 10, createdAt };
  }
  // A lead marked Lost without ever being contacted is DEAD, not answered —
  // clock off, ungraded (it must not read "responded", and a dead lead
  // shouldn't scream "breached" forever either).
  if (lead.status === "Lost") return { state: "not_applicable" };
  // A lead that moved past New Lead without any recorded moment still counts
  // as responded — we just can't grade the speed.
  if (lead.status !== "New Lead") return { state: "responded", responseMinutes: null, createdAt };

  const elapsed = now.getTime() - created;
  if (elapsed < FIVE_MINUTES_MS) {
    return { state: "on_clock", secondsLeft: Math.max(0, Math.ceil((FIVE_MINUTES_MS - elapsed) / 1000)), createdAt };
  }
  return { state: "breached", minutesOver: Math.floor((elapsed - FIVE_MINUTES_MS) / 60000), createdAt };
}

export type SpeedStats = {
  /** Leads in the window with a measurable response time. */
  measured: number;
  under5Pct: number; // 0–100, of measured
  avgMinutes: number | null;
  medianMinutes: number | null;
  /** New Leads on the clock or breached RIGHT NOW (not window-bound). */
  onClockNow: number;
  breachedNow: number;
  byRep: { name: string; measured: number; under5Pct: number; avgMinutes: number | null }[];
};

export function speedStats(leads: CrmLead[], now = new Date(), windowDays = STATS_WINDOW_DAYS): SpeedStats {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const times: number[] = [];
  const perRep = new Map<string, number[]>();
  let onClockNow = 0;
  let breachedNow = 0;

  for (const lead of leads) {
    const clock = speedClock(lead, now);
    if (clock.state === "on_clock") onClockNow += 1;
    if (clock.state === "breached") breachedNow += 1;
    if (clock.state !== "responded" || clock.responseMinutes === null) continue;
    if (new Date(clock.createdAt).getTime() < cutoff) continue;
    times.push(clock.responseMinutes);
    const rep = lead.salesperson || "Unassigned";
    perRep.set(rep, [...(perRep.get(rep) ?? []), clock.responseMinutes]);
  }

  const pctUnder5 = (list: number[]) => (list.length ? Math.round((list.filter((m) => m <= 5).length / list.length) * 100) : 0);
  const avg = (list: number[]) => (list.length ? Math.round((list.reduce((t, m) => t + m, 0) / list.length) * 10) / 10 : null);
  const median = (list: number[]) => {
    if (!list.length) return null;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  };

  return {
    measured: times.length,
    under5Pct: pctUnder5(times),
    avgMinutes: avg(times),
    medianMinutes: median(times),
    onClockNow,
    breachedNow,
    byRep: [...perRep.entries()]
      .map(([name, list]) => ({ name, measured: list.length, under5Pct: pctUnder5(list), avgMinutes: avg(list) }))
      .sort((a, b) => b.measured - a.measured),
  };
}

/** The patch that stamps first contact — only ever the FIRST time. */
export function firstContactPatch(
  lead: Pick<CrmLead, "firstContactAt">,
  now = new Date(),
): { firstContactAt: string } | null {
  if (lead.firstContactAt) return null;
  return { firstContactAt: now.toISOString() };
}
