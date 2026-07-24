import { describe, it, expect } from "vitest";
import { grossBreakdownLine } from "./ila";
import type { Deal, DealStatus } from "./types";

const unit = { singular: "unit", plural: "units" };

function deal(amount: number, secondary: number, addons = 0): Deal {
  return { id: `d${amount}${secondary}${addons}`, date: "2026-07-10T12:00:00Z", customer: "C", item: "", amount, secondary, addons, reserve: 0, status: "delivered" as DealStatus };
}

describe("grossBreakdownLine — EILA can break down front vs F&I gross", () => {
  it("splits total gross into front and F&I/back, with the blended PVR on a total-basis plan", () => {
    // Two delivered deals: fronts 2000 + 3000 = 5000; F&I 1500 + 500 = 2000.
    const line = grossBreakdownLine([deal(2000, 1500, 2), deal(3000, 500, 1)], unit, "total");
    expect(line).toContain("total gross $7,000");
    expect(line).toContain("front gross $5,000");
    expect(line).toContain("F&I/back gross $2,000");
    expect(line).toContain("PVR $3,500"); // 7000 / 2 units — correct ONLY on a total-basis plan
    expect(line).toContain("F&I products 3");
  });

  // The July 23 trap, still living in EILA's prompt until July 24: on a back-end
  // F&I grid "PVR" means F&I gross per car, and calling the blended front+back
  // average "PVR" overstates it by the ENTIRE front gross. It sat one line above
  // the correct back-only PVR, so her prompt carried two contradictory PVRs.
  it("on a BACK-basis plan their PVR is F&I-only, and the blended number is explicitly disowned", () => {
    const line = grossBreakdownLine([deal(2000, 1500, 2), deal(3000, 500, 1)], unit, "back");
    expect(line).toContain("F&I PVR $1,000"); // 2000 back / 2 units — THEIR number
    expect(line).toContain("NEVER call that their PVR");
    expect(line).toContain("STORE'S money");
    expect(line).not.toContain("PVR $3,500"); // the blended figure is never labeled their PVR
  });

  it("on a FRONT-basis plan their PVR is front-only", () => {
    const line = grossBreakdownLine([deal(2000, 1500, 2), deal(3000, 500, 1)], unit, "front");
    expect(line).toContain("front PVR $2,500"); // 5000 front / 2 units
    expect(line).not.toContain("PVR $3,500");
  });

  it("flags when no F&I back-end was logged, so she says so instead of implying $0 is real", () => {
    const line = grossBreakdownLine([deal(3000, 0, 2), deal(2500, 0, 0)], unit);
    expect(line).toContain("F&I/back gross $0");
    expect(line).toContain("no back-end was logged");
  });

  it("handles an empty month without dividing by zero", () => {
    expect(grossBreakdownLine([], unit)).toContain("no delivered deals logged yet");
  });
});
