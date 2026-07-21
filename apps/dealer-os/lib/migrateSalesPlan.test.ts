import test from "node:test";
import assert from "node:assert/strict";
import { salesPlanToCompPlan } from "./migrateSalesPlan.ts";
import { KENNESAW_SALES_COMP_PLAN } from "./salesCompPlan.ts";
import { computePay } from "./payEngine.ts";
import type { SalesPlan } from "@/components/PayPlanProvider";

// Kennesaw's default SalesPlan numbers, inline (avoids importing the client
// PayPlanProvider component into a node test). If defaultSalesPlan changes, this
// literal should be updated to match — the parity test below guards the mapping.
const KENNESAW_DEFAULT: SalesPlan = {
  newHighFlat: 400, newHighMin: 1,
  newMidFlat: 250, newMidMin: -300,
  newMiniFlat: 150,
  usedPct: 25, usedHighPct: 30, usedHighMin: 3000, usedMinCommission: 150,
  miniCommission: 150,
  volumeTiers: [
    { units: 24, bonus: 1900 }, { units: 21, bonus: 1600 }, { units: 18, bonus: 1300 },
    { units: 15, bonus: 1000 }, { units: 12, bonus: 500 },
  ],
  financeBonusUnits: 10, financeBonusBackPvr: 1300, financeBonusAmount: 500,
  fastStartUnits: 7, fastStartByDay: 15, fastStartAmount: 500,
};

const gross = (plan: import("./payEngine.ts").CompPlan, perf: Record<string, number>, rows?: import("./payEngine.ts").DealRow[]) =>
  computePay(plan, perf, rows).grossCommission;

test("migrated default plan matches KENNESAW_SALES_COMP_PLAN exactly (parity)", () => {
  const { plan } = salesPlanToCompPlan(KENNESAW_DEFAULT);
  const cases: Array<[Record<string, number>, import("./payEngine.ts").DealRow[]]> = [
    [{ units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp: 500, vehicleClass: "New", share: 1 }]],
    [{ units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp: -100, vehicleClass: "New", share: 1 }]],
    [{ units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp: -400, vehicleClass: "New", share: 1 }]],
    [{ units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp: 4000, vehicleClass: "Used", share: 1 }]],
    [{ units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp: 200, vehicleClass: "Used", share: 1 }]],
    [{ units: 12, pvr: 1400, fastStartUnits: 12 }, Array.from({ length: 12 }, () => ({ cgp: 500, vehicleClass: "New", share: 1 }))],
    [{ units: 12, pvr: 1200, fastStartUnits: 0 }, [{ cgp: 500, vehicleClass: "New", share: 1 }]],
    // The whole volume ladder — the top rungs were previously unproven.
    [{ units: 15, pvr: 1400, fastStartUnits: 0 }, Array.from({ length: 15 }, () => ({ cgp: 500, vehicleClass: "New", share: 1 }))],
    [{ units: 18, pvr: 1400, fastStartUnits: 0 }, Array.from({ length: 18 }, () => ({ cgp: 500, vehicleClass: "New", share: 1 }))],
    [{ units: 21, pvr: 1400, fastStartUnits: 0 }, Array.from({ length: 21 }, () => ({ cgp: 500, vehicleClass: "New", share: 1 }))],
    [{ units: 24, pvr: 1400, fastStartUnits: 24 }, Array.from({ length: 24 }, () => ({ cgp: 500, vehicleClass: "New", share: 1 }))],
  ];
  for (const [perf, rows] of cases) {
    assert.equal(gross(plan, perf, rows), gross(KENNESAW_SALES_COMP_PLAN, perf, rows), `mismatch for ${JSON.stringify(perf)}`);
  }
});

test("custom numbers flow through the conversion", () => {
  const custom: SalesPlan = { ...KENNESAW_DEFAULT, usedPct: 20, newHighFlat: 600 };
  const { plan } = salesPlanToCompPlan(custom);
  // Used $2,000 at 20% = $400 (vs $500 at the default 25%).
  assert.equal(gross(plan, { units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp: 2000, vehicleClass: "Used", share: 1 }]), 400);
  // New high band now pays $600.
  assert.equal(gross(plan, { units: 1, pvr: 0, fastStartUnits: 0 }, [{ cgp: 500, vehicleClass: "New", share: 1 }]), 600);
});

test("bonusEligible=false surfaces a note (engine can't model the gate)", () => {
  const { notes } = salesPlanToCompPlan({ ...KENNESAW_DEFAULT, bonusEligible: false });
  assert.ok(notes.some((n) => n.toLowerCase().includes("bonuseligible")));
});
