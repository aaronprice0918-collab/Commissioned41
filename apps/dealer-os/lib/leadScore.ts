import type { CrmLead, LeadStatus } from "@/components/CrmProvider";

// ── AI Lead Scoring + follow-up cadence ──────────────────────────────────────
// Deterministic, EXPLAINABLE 0–100 buying-intent score and a structured
// follow-up cadence (Day 1 / 3 / 7 / 14 / 30) computed entirely from data the
// store already has — no external feed, no AI call, instant. "Explainable" is
// the point: every score ships with the factors that built it, so a rep trusts
// it (the gap legacy CRMs leave with black-box "buy signals").

export type LeadScoreLabel = "Hot" | "Warm" | "Nurture" | "Cold";

export type LeadScore = {
  score: number; // 0–100
  label: LeadScoreLabel;
  factors: { label: string; points: number }[]; // the "why", best-first
  ageDays: number;
  cadenceStage: string; // Day 1 / Day 3 / ...
  recommendedTouch: string; // the concrete next move
  overdue: boolean; // a touch is due and nothing's scheduled
};

const OPEN_STATUSES: LeadStatus[] = ["New Lead", "Working", "Appointment Set", "Shown", "Desking", "In Finance"];

// Funnel depth — further in = hotter intent.
const STATUS_POINTS: Record<LeadStatus, number> = {
  "New Lead": 12,
  Working: 22,
  "Appointment Set": 38,
  Shown: 46,
  Desking: 60,
  "In Finance": 70,
  Won: 0,
  Lost: 0,
};

export function isOpenLead(lead: CrmLead): boolean {
  return OPEN_STATUSES.includes(lead.status);
}

// Lead creation time — the id is minted as `CRM-<ms>`; fall back to `date`.
export function leadCreatedMs(lead: CrmLead): number {
  const m = /(\d{12,})/.exec(lead.id || "");
  if (m) return Number(m[1]);
  if (lead.date) {
    const t = new Date(`${lead.date}T12:00:00`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}

// When the lead entered its CURRENT status — the latest matching statusHistory
// entry, falling back to lead creation for leads logged before history existed.
export function stageEnteredMs(lead: CrmLead): number {
  const h = lead.statusHistory;
  if (h && h.length) {
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].status === lead.status) {
        const t = new Date(h[i].at).getTime();
        if (!Number.isNaN(t)) return t;
      }
    }
  }
  return leadCreatedMs(lead);
}

// A deal "at risk" — sitting too long in a stage that should keep moving, or a
// working lead that's gone stale. Thresholds are deliberately conservative.
export function isAtRisk(lead: CrmLead, now: number): boolean {
  const inStage = now - stageEnteredMs(lead);
  const H = 3_600_000;
  if (lead.status === "Desking") return inStage > 4 * H;
  if (lead.status === "In Finance") return inStage > 24 * H;
  if (lead.status === "Working") return now - leadCreatedMs(lead) > 3 * 24 * H;
  return false;
}

function labelFor(score: number): LeadScoreLabel {
  if (score >= 70) return "Hot";
  if (score >= 45) return "Warm";
  if (score >= 25) return "Nurture";
  return "Cold";
}

// The structured cadence touch for a given age + status.
function cadence(ageDays: number, status: LeadStatus): { stage: string; due: number } {
  // `due` = the day-of-cadence on which a touch is expected.
  if (ageDays < 1) return { stage: "Day 1 — first contact", due: 0 };
  if (ageDays < 3) return { stage: "Day 1–3 — second touch", due: 1 };
  if (ageDays < 7) return { stage: "Day 3–7 — value follow-up", due: 3 };
  if (ageDays < 14) return { stage: "Day 7–14 — check-in", due: 7 };
  if (ageDays < 30) return { stage: "Day 14–30 — nurture", due: 14 };
  return { stage: "Day 30+ — long-term revive", due: 30 };
}

function nowMs(now?: number): number {
  return now ?? Date.now();
}

export function scoreLead(lead: CrmLead, now?: number): LeadScore {
  const factors: { label: string; points: number }[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) factors.push({ label, points });
  };

  // Funnel depth
  add(`In ${lead.status}`, STATUS_POINTS[lead.status] ?? 0);

  // Appointment momentum
  const apptDay = lead.appointment ? lead.appointment.slice(0, 10) : "";
  // LOCAL day key: appointments are local datetime-local strings — comparing
  // them to a UTC key flipped every appointment to "passed" after ~8pm ET.
  const d = new Date(nowMs(now));
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (apptDay) {
    if (apptDay >= today) add("Appointment scheduled", apptDay === today ? 18 : 22);
    else add("Appointment passed — re-engage", -6);
  }

  // Recency — fresh leads are hot; old open ones go cold.
  const ageMs = nowMs(now) - leadCreatedMs(lead);
  const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));
  if (ageDays < 1) add("Brand-new lead", 20);
  else if (ageDays < 3) add("Fresh (under 3 days)", 12);
  else if (ageDays < 7) add("This week", 6);
  else if (ageDays >= 21) add("Going cold (3+ weeks)", -12);
  else if (ageDays >= 14) add("Cooling (2+ weeks)", -6);

  // Credit progress = real buyer
  const credit = lead.creditStatus;
  if (credit === "Approved") add("Credit approved", 16);
  else if (credit === "Submitted" || credit === "Received") add("Credit in progress", 10);
  else if (credit === "Sent") add("Credit app sent", 5);

  // Trade equity = motivation + structure
  const equity = (Number(lead.tradeAcv) || 0) - (Number(lead.payoff) || 0);
  if (lead.tradeAcv && equity > 0) add("Positive trade equity", 8);

  // Contactability + vehicle identified
  if (lead.customerPhone) add("Phone on file", 3);
  if (lead.customerEmail) add("Email on file", 3);
  if (lead.vin || lead.stockNumber) add("Vehicle identified", 5);

  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  factors.sort((a, b) => b.points - a.points);

  const { stage, due } = cadence(ageDays, lead.status);
  // Overdue = an open lead past its cadence touch day with no upcoming
  // appointment. Day-0 leads are NEVER "overdue" — a 30-second-old lead used
  // to show a red Overdue pill next to a green in-the-window speed clock; the
  // 5-minute clock owns the first-contact urgency, the cadence owns day 1+.
  const upcomingAppt = !!apptDay && apptDay >= today;
  const overdue =
    isOpenLead(lead) && ageDays >= 1 && ageDays >= due && !upcomingAppt && lead.status !== "Desking" && lead.status !== "In Finance";

  return {
    score,
    label: labelFor(score),
    factors,
    ageDays,
    cadenceStage: stage,
    recommendedTouch: recommendTouch(lead, ageDays, upcomingAppt),
    overdue,
  };
}

// The concrete next move — status + cadence aware, phrased for a rep on the floor.
function recommendTouch(lead: CrmLead, ageDays: number, upcomingAppt: boolean): string {
  const first = (lead.customer || "the customer").split(" ")[0];
  switch (lead.status) {
    case "New Lead":
      return ageDays < 1 ? `Call ${first} now — fresh up, respond in under 5 minutes.` : `Reach ${first} — first contact is overdue. Call, then text.`;
    case "Working":
      return upcomingAppt ? `Confirm ${first}'s appointment so it shows.` : `Set an appointment with ${first} — give a reason to come in today.`;
    case "Appointment Set":
      return upcomingAppt ? `Confirm ${first} and send directions.` : `${first}'s appointment lapsed — reschedule before the lead goes cold.`;
    case "Shown":
      return `Follow up on ${first}'s visit — answer the objection and bring numbers back.`;
    case "Desking":
      return `${first} is at the desk — get a manager and close the gap on numbers.`;
    case "In Finance":
      return `${first} is in finance — keep funding clean and confirm delivery.`;
    default:
      return `Re-engage ${first} with a fresh inventory match or a payment option.`;
  }
}
