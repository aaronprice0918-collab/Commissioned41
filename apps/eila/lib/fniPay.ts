// THE LOGG, assembled. This is the one place that stitches the two money
// engines into the single picture a finance manager actually reads on their
// pay tracker:
//   • the audited GRID commission (calc.ts) — base % by PVR×PPU + PVR/VSC rate
//     bonuses, less the recoverable draw, and
//   • the SPIFF layer (spiffs.ts) — the ungated NAS flat + the PPU/PVR-gated,
//     penetration-tiered TWS package.
// Commission and spiffs are BOTH money earned this month; the draw is an advance
// against the commission side only (spiffs aren't advanced against), so the
// check building beyond all advances is (commission beyond draw) + spiffs.
//
// Kept deliberately thin: it calls the frozen engines, never re-implements them.

import type { Deal, Profile } from "./types";
import type { PayResult } from "./payplan/types";
import { calculatePay } from "./payplan/calc";
import { perfFromDeals } from "./engine";
import { isProductOnly } from "./productOnly";
import {
  computeSpiffs,
  fniSpiffInput,
  KENNESAW_SPIFFS,
  type SpiffPlan,
  type SpiffResult,
} from "./payplan/spiffs";
import { productDefs } from "./fni";

export interface FniPayPicture {
  units: number;
  pvr: number; // F&I back gross per retail unit (no-qualify deals drag it, matching THE LOGG)
  ppu: number; // product units per retail unit
  pay: PayResult; // grid commission + rate bonuses + draw math
  spiffs: SpiffResult; // NAS flat + TWS gated package
  spiffPlan: SpiffPlan;
  totalEarned: number; // commission earned + spiffs — the month's full worth
  aboveDrawWithSpiffs: number; // (commission beyond every advance) + spiffs — the real check building
}

// Does this rep's plan pay on an F&I back-end grid? That's the finance manager
// THE LOGG describes — a PVR×PPU grid on back gross. Only those plans get the
// spiff layer (the schedule below is Kennesaw's; it doesn't apply to a rep on a
// front-end % plan).
export function isFinanceGridPlan(plan: { grid?: { basis?: string } } | null | undefined): boolean {
  return plan?.grid?.basis === "back";
}

// Assemble the full THE LOGG picture from a month's counted (delivered) deals.
// `spiffPlan` defaults to Kennesaw's schedule; pass another store's when we
// encode one. Returns null when the plan isn't an F&I grid plan (no spiffs to
// layer) so callers can cleanly skip the section.
export function fniPayPicture(
  profile: Profile,
  counted: Deal[],
  spiffPlan: SpiffPlan = KENNESAW_SPIFFS,
): FniPayPicture | null {
  const plan = profile.plan;
  if (!isFinanceGridPlan(plan)) return null;

  // THE LOGG's finance metrics run on RETAIL TOUCHES only — New/Used/CPO. No-qualify
  // (DNQ) deals keep the salesperson's unit but are excluded from the finance
  // manager's PVR/PPU denominator and F&I gross, so drop them here before the math.
  const retail = counted.filter((d) => !d.noQualify);
  const defs = productDefs(profile);
  const pay = calculatePay(plan, perfFromDeals(retail));
  const sIn = fniSpiffInput(retail, defs);
  const spiffs = computeSpiffs(spiffPlan, sIn);

  return {
    units: retail.filter((d) => !isProductOnly(d)).length, // cars only; product-only isn't a unit
    pvr: sIn.pvr,
    ppu: sIn.ppu,
    pay,
    spiffs,
    spiffPlan,
    totalEarned: pay.grossPay + spiffs.total,
    aboveDrawWithSpiffs: pay.aboveDraw + spiffs.total,
  };
}
