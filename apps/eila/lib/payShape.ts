// THE PAY SHAPE — the one honest answer to: "how much must I earn before the
// next dollar is actually MINE, and where do I stand against it?"
//
// Aaron, July 2026: "This logic needs to be adaptable — my pay plan won't be the
// same as other people's. EILA needs to be smart enough to adapt, otherwise the
// whole point is void." He asked for a draw-as-HOLE / stack-above-ground view,
// and for HIS plan that's exactly right — his draw is recoverable, so it's debt
// he digs out of. But a hole is a LIE on other plans:
//   • a NON-recoverable draw is money the rep keeps (the new-hire guarantee),
//   • a guaranteeFloor is a floor you stand on,
//   • plenty of reps have no draw at all — dollar one is theirs.
// So the shape is DERIVED FROM THE PLAN, never assumed:
//   "hole"     → recoverable advance: you owe it back, dig out first, then stack.
//   "platform" → guaranteed money: it's already yours; commission above it is upside.
//   "open"     → no threshold at all: every dollar counts from zero.
//
// ONE BRAIN: the Home visual, the Money after-tax view, and EILA all read this
// same function, so a different VIEW can never become a different NUMBER.
//
// AXIS: everything here is GROSS dollars (Aaron: "put the after tax view in the
// Money section"). A take-home goal is converted onto the gross axis via the
// plan's tax rate so the goal marker sits on the same ruler as the draw — mixing
// a take-home goal with a gross draw on one axis is what made the old Climb
// unreadable.
import type { PayPlan, PayResult } from "./payplan/types";

export type PayShapeKind = "hole" | "platform" | "open";

export interface PayShape {
  kind: PayShapeKind;
  /** Gross earned so far this month (banked). */
  earned: number;
  /** Gross that must be cleared before the next dollar is incremental. 0 when "open". */
  threshold: number;
  /** Plain-language name for that threshold, ready to render. */
  thresholdLabel: string;
  /** How much of the threshold is covered so far (0..threshold). */
  filled: number;
  /** Still to clear. For "hole" this is the debt remaining; 0 once cleared. */
  remaining: number;
  /** Gross earned ABOVE the threshold — the stack. */
  above: number;
  /** 0..1 progress through the threshold (1 once cleared). */
  thresholdPct: number;
  cleared: boolean;
  /** The month's goal on the SAME gross axis (undefined when no goal is set). */
  goalGross?: number;
  /** Where goalGross came from, so a view can label it honestly. */
  goalSource?: "takeHome";
  /** Projected month-end gross if the current pace holds (undefined if not supplied). */
  pacedGross?: number;
  /** Projected gross above the threshold at that pace. */
  pacedAbove?: number;
  /** Tax rate used for any take-home conversion (0 = none configured). */
  taxRate: number;
}

/** Gross needed to net a given take-home amount at this tax rate. */
export function grossForTakeHome(takeHome: number, taxRate: number): number {
  const keep = taxRate > 0 && taxRate < 100 ? 1 - taxRate / 100 : 1;
  return keep > 0 ? takeHome / keep : takeHome;
}

/** Take-home left after tax on a gross amount. */
export function takeHomeOf(gross: number, taxRate: number): number {
  const keep = taxRate > 0 && taxRate < 100 ? 1 - taxRate / 100 : 1;
  return gross * keep;
}

export function payShape(plan: PayPlan, pay: PayResult, pacedGross?: number): PayShape {
  const taxRate = plan.taxRate ?? 0;
  const earned = Math.max(0, pay.grossPay);

  const draw = plan.draw?.amount ?? 0;
  // `recoverable` defaults to TRUE when unset: an advance is the common case and
  // the safe assumption is the one that doesn't promise money the rep may owe back.
  const recoverable = plan.draw?.recoverable !== false;
  const carriedIn = recoverable ? plan.drawCarriedIn ?? 0 : 0;

  // A recoverable draw (plus any rolled-over balance) is DEBT → a hole.
  const holeDepth = recoverable ? draw + carriedIn : 0;
  // A non-recoverable draw and a guarantee floor are both money already yours → a platform.
  const platformHeight = Math.max(plan.guaranteeFloor ?? 0, recoverable ? 0 : draw);

  let kind: PayShapeKind;
  let threshold: number;
  let thresholdLabel: string;
  if (holeDepth > 0) {
    kind = "hole";
    threshold = holeDepth;
    thresholdLabel = carriedIn > 0 ? "Draw + carried balance to pay back" : "Draw to pay back";
  } else if (platformHeight > 0) {
    kind = "platform";
    threshold = platformHeight;
    thresholdLabel = (plan.guaranteeFloor ?? 0) >= platformHeight ? "Guaranteed either way" : "Draw guaranteed (yours to keep)";
  } else {
    kind = "open";
    threshold = 0;
    thresholdLabel = "";
  }

  const filled = Math.min(earned, threshold);
  const remaining = Math.max(0, threshold - earned);
  const above = Math.max(0, earned - threshold);
  const thresholdPct = threshold > 0 ? Math.min(1, earned / threshold) : 1;

  const goalGross = plan.takeHomeGoal && plan.takeHomeGoal > 0 ? grossForTakeHome(plan.takeHomeGoal, taxRate) : undefined;

  return {
    kind,
    earned,
    threshold,
    thresholdLabel,
    filled,
    remaining,
    above,
    thresholdPct,
    cleared: remaining <= 0,
    ...(goalGross !== undefined ? { goalGross, goalSource: "takeHome" as const } : {}),
    ...(pacedGross !== undefined
      ? { pacedGross, pacedAbove: Math.max(0, pacedGross - threshold) }
      : {}),
    taxRate,
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * One plain-language sentence for the shape — what EILA says and what the card
 * shows, from the SAME source, so her words and the screen can't diverge.
 */
export function payShapeSentence(s: PayShape): string {
  if (s.kind === "hole") {
    return s.cleared
      ? `You're out of the hole. Your ${money(s.threshold)} draw is paid back and ${money(s.above)} on top is really yours.`
      : `You're climbing out: ${money(s.filled)} of your ${money(s.threshold)} draw is paid back, ${money(s.remaining)} to go before the next dollar is yours.`;
  }
  if (s.kind === "platform") {
    // Pay is floored UP to a guarantee, so `remaining` is always 0 here — being
    // "past it" means commission actually exceeds the guarantee, not that a debt
    // got cleared. Never imply they climbed out of something they never owed.
    return s.above > 0
      ? `You're past your ${money(s.threshold)} guarantee — ${money(s.above)} of commission on top of it.`
      : `You're guaranteed ${money(s.threshold)} no matter what, and that's yours to keep. Commission starts adding on top once you earn past ${money(s.threshold)}.`;
  }
  return `Every dollar counts from the first one — ${money(s.earned)} earned so far this month.`;
}
