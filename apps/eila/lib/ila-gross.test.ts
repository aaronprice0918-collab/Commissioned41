import { describe, it, expect } from "vitest";
import { grossBreakdownLine } from "./ila";
import type { Deal, DealStatus } from "./types";

const unit = { singular: "unit", plural: "units" };

function deal(amount: number, secondary: number, addons = 0): Deal {
  return { id: `d${amount}${secondary}${addons}`, date: "2026-07-10T12:00:00Z", customer: "C", item: "", amount, secondary, addons, reserve: 0, status: "delivered" as DealStatus };
}

describe("grossBreakdownLine — EILA can break down front vs F&I gross", () => {
  it("splits total gross into front and F&I/back with PVR", () => {
    // Two delivered deals: fronts 2000 + 3000 = 5000; F&I 1500 + 500 = 2000.
    const line = grossBreakdownLine([deal(2000, 1500, 2), deal(3000, 500, 1)], unit);
    expect(line).toContain("total gross $7,000");
    expect(line).toContain("front gross $5,000");
    expect(line).toContain("F&I/back gross $2,000");
    expect(line).toContain("PVR $3,500"); // 7000 / 2 units
    expect(line).toContain("F&I products 3");
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
