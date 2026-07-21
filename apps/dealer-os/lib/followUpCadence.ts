// Follow-up cadences — AI-drafted drip sequences that ride a lead through
// the pipeline. EILA picks the cadence based on the lead's stage and context;
// the cron fires each step at the scheduled time; the rep approves the draft
// before it goes out (same two-step pattern as text_customer). A cadence is
// attached to a lead (lead.cadence on the JSONB blob).
//
// Design: each step is a TEMPLATE that EILA drafts at fire-time using the
// lead's live context (not static text saved at schedule-time), so a vehicle
// price change or a new incentive shows up in the follow-up automatically.

export type CadenceTemplate = "new_lead" | "post_visit" | "post_quote" | "service_followup" | "equity_trade" | "custom";

export type CadenceStep = {
  day: number; // days after cadence start (0 = immediately)
  intent: string; // what this step should accomplish (EILA uses this to draft)
  channel: "text" | "email"; // for now, text only
};

export type CadenceState = {
  template: CadenceTemplate;
  startedAt: string; // ISO
  startedBy: string; // staff name or "EILA"
  currentStep: number; // index into the steps array
  nextFireAt: string; // ISO — when the next step fires
  status: "active" | "paused" | "completed" | "cancelled";
  pausedReason?: string;
  customSteps?: CadenceStep[]; // only for "custom" template
};

// Built-in cadence templates — the step intents are instructions for EILA
// to draft contextually at fire-time, NOT canned messages.
export const CADENCE_TEMPLATES: Record<Exclude<CadenceTemplate, "custom">, { label: string; steps: CadenceStep[] }> = {
  new_lead: {
    label: "New Lead — 14-day nurture",
    steps: [
      { day: 0, intent: "Warm intro — mention the vehicle they inquired about, invite them in for a look. Short, human, first-name signed.", channel: "text" },
      { day: 3, intent: "Soft follow-up — did they have questions? Mention one specific feature of the vehicle that matches their interest.", channel: "text" },
      { day: 7, intent: "Value add — share a relevant incentive, rate, or availability update if one exists. If not, a simple 'still here if you need anything' with the rep's direct line.", channel: "text" },
      { day: 14, intent: "Last touch — let them know the vehicle is still available (or suggest alternatives if it sold), no pressure. Leave the door open.", channel: "text" },
    ],
  },
  post_visit: {
    label: "Post-Visit — didn't close",
    steps: [
      { day: 1, intent: "Thank them for coming in. Reference their specific vehicle and any numbers discussed. Let them know you're available.", channel: "text" },
      { day: 3, intent: "Address their likely objection (price, payment, trade value, thinking about it). Offer one specific piece of value (a better rate, a different term, a manager special).", channel: "text" },
      { day: 7, intent: "Soft urgency — mention if the vehicle is getting interest, if an incentive is expiring, or if month-end is approaching. Not pushy, just real.", channel: "text" },
      { day: 14, intent: "Check-in — are they still in the market? If yes, you're ready. If they went elsewhere, wish them well and leave the door open for service.", channel: "text" },
    ],
  },
  post_quote: {
    label: "Post-Quote — numbers sent",
    steps: [
      { day: 1, intent: "Quick follow-up on the numbers you sent. 'Had a chance to look them over?' One line, conversational.", channel: "text" },
      { day: 3, intent: "If there's a better option (different term, different vehicle, manager willing to move) mention it. Otherwise, just check in.", channel: "text" },
      { day: 5, intent: "Gentle close — 'I've got your deal penciled, just need you to come grab the keys.' Month-end urgency if applicable.", channel: "text" },
    ],
  },
  service_followup: {
    label: "Service — declined work follow-up",
    steps: [
      { day: 3, intent: "Follow up on the declined service work — remind them what was recommended, why it matters for their vehicle's longevity, and that you held the quote.", channel: "text" },
      { day: 14, intent: "Second touch — mention seasonal relevance if applicable (tires before winter, AC before summer). Offer to schedule at their convenience.", channel: "text" },
    ],
  },
  equity_trade: {
    label: "Equity/Trade-Up opportunity",
    steps: [
      { day: 0, intent: "Reach out about their current vehicle — mention how long they've had it, current market value trends, and new model availability. Conversational, not salesy.", channel: "text" },
      { day: 7, intent: "Share a specific upgrade option with estimated payment change. Use their known preferences if available.", channel: "text" },
      { day: 21, intent: "Light touch — 'When you're ready to explore upgrading, I'm here.' No pressure.", channel: "text" },
    ],
  },
};

/** Get the steps for a cadence (built-in or custom). */
export function cadenceSteps(state: CadenceState): CadenceStep[] {
  if (state.template === "custom" && state.customSteps) return state.customSteps;
  return CADENCE_TEMPLATES[state.template]?.steps ?? [];
}

/** Calculate when the next step fires based on the cadence start and step day offset. */
export function nextFireTime(startedAt: string, step: CadenceStep): string {
  const start = new Date(startedAt);
  start.setDate(start.getDate() + step.day);
  // Fire at 10am local — the customer's morning, not 3am.
  start.setHours(10, 0, 0, 0);
  return start.toISOString();
}

/** Create a fresh cadence state to attach to a lead. */
export function startCadence(
  template: CadenceTemplate,
  startedBy: string,
  customSteps?: CadenceStep[],
): CadenceState {
  const now = new Date().toISOString();
  const steps = template === "custom" && customSteps ? customSteps : CADENCE_TEMPLATES[template]?.steps ?? [];
  return {
    template,
    startedAt: now,
    startedBy,
    currentStep: 0,
    nextFireAt: steps.length ? nextFireTime(now, steps[0]) : now,
    status: "active",
    ...(template === "custom" && customSteps ? { customSteps } : {}),
  };
}

/** Advance to the next step or complete the cadence. */
export function advanceCadence(state: CadenceState): CadenceState {
  const steps = cadenceSteps(state);
  const nextIdx = state.currentStep + 1;
  if (nextIdx >= steps.length) {
    return { ...state, currentStep: nextIdx, status: "completed" };
  }
  return {
    ...state,
    currentStep: nextIdx,
    nextFireAt: nextFireTime(state.startedAt, steps[nextIdx]),
  };
}

/** Pause the cadence (e.g., customer replied — human should take over). */
export function pauseCadence(state: CadenceState, reason: string): CadenceState {
  return { ...state, status: "paused", pausedReason: reason };
}

/** Summary for EILA. */
export function cadenceSummary(state: CadenceState | undefined): string {
  if (!state) return "no cadence";
  const steps = cadenceSteps(state);
  const label = state.template === "custom" ? "Custom cadence" : (CADENCE_TEMPLATES[state.template]?.label ?? state.template);
  if (state.status !== "active") return `${label} — ${state.status}${state.pausedReason ? ` (${state.pausedReason})` : ""}`;
  return `${label} — step ${state.currentStep + 1}/${steps.length}, next fires ${new Date(state.nextFireAt).toLocaleDateString()}`;
}
