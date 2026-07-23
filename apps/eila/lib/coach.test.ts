import { describe, it, expect } from "vitest";
import { coach, todaysMission, Insight } from "./coach";
import { forecast } from "./engine";
import { makePlan, kennesawFinancePlan } from "./payplan/plans";
import { Deal, DealStatus } from "./types";

const NOW = new Date("2025-06-15T12:00:00");

let seq = 0;
function deal(p: Partial<Deal> & { status: DealStatus }): Deal {
  seq += 1;
  return {
    id: `d${seq}`,
    date: "2025-06-05T10:00:00",
    customer: `Cust ${seq}`,
    item: "CX-5",
    category: "new",
    amount: 2000,
    secondary: 1000,
    addons: 2,
    reserve: 0,
    ...p,
  };
}

function kinds(ins: Insight[]) {
  return ins.map((i) => i.kind);
}
function texts(ins: Insight[]) {
  return ins.map((i) => i.text).join("\n");
}

// A flat sales plan with a goal; no grid → no rate-tier "money" move, so the
// momentum (#6) rule can be observed in isolation.
const salesPlan = makePlan({
  role: "sales",
  base: { salary: 0, frontPct: 25, backPct: 5, perUnit: 0, perProduct: 50, basis: "total" },
  goalUnits: 15,
});

// Grid plan (Kennesaw F&I) → produces nextTiers with addPay > 0 and flags
// missing optional metrics (CSI, menu, VSC, ...).
const gridPlan = kennesawFinancePlan();

describe("coach() — best money opportunity (rule 1)", () => {
  it("fires a 'money' insight when the grid suggests a next tier worth real $", () => {
    // 4 delivered, back 1000 each → PVR 1000 (below grid floor), PPU 2.0; there
    // IS a higher PVR/PPU cell to climb to, so addPay > 0.
    const deals = [
      deal({ status: "delivered", secondary: 1000, addons: 2 }),
      deal({ status: "delivered", secondary: 1000, addons: 2 }),
      deal({ status: "delivered", secondary: 1000, addons: 2 }),
      deal({ status: "delivered", secondary: 1000, addons: 2 }),
    ];
    const ins = coach(gridPlan, deals, "automotive", NOW);
    const money = ins.find((i) => i.kind === "money");
    expect(money).toBeTruthy();
    expect(money!.text).toMatch(/more this month/);
  });
});

describe("coach() — pace vs goal (rule 2)", () => {
  it("emits a 'pace' nudge with the unit gap when behind the goal", () => {
    // 2 delivered by day 15 → pace 4 units, goal 15 → behind
    const deals = [deal({ status: "delivered" }), deal({ status: "delivered" })];
    const ins = coach(salesPlan, deals, "automotive", NOW);
    const pace = ins.find((i) => i.kind === "pace");
    expect(pace).toBeTruthy();
    expect(pace!.text).toMatch(/15-vehicle goal/);
    expect(pace!.text).toMatch(/days gets you there/);
    // behind goal → no "ahead of your goal" win (a momentum win may still appear)
    expect(texts(ins)).not.toMatch(/ahead of your/);
  });

  it("emits a 'win' when pacing at or above the goal", () => {
    // 8 delivered by day 15 → pace 16, goal 15 → ahead
    const deals = Array.from({ length: 8 }, () => deal({ status: "delivered" }));
    const ins = coach(salesPlan, deals, "automotive", NOW);
    const win = ins.find((i) => i.kind === "win" && /ahead of your/.test(i.text));
    expect(win).toBeTruthy();
    expect(kinds(ins)).not.toContain("pace");
  });
});

describe("coach() — missing-data nudge (rule 3)", () => {
  it("nudges to add CSI/menu/VSC-type metrics that would sharpen the grid forecast", () => {
    const deals = [deal({ status: "delivered", secondary: 1300, addons: 2 })];
    const ins = coach(gridPlan, deals, "automotive", NOW);
    const push = ins.find((i) => i.kind === "push" && /sharpen the forecast/.test(i.text));
    expect(push).toBeTruthy();
  });

  it("does NOT fire the missing-data nudge for a plain flat plan (no optional metrics)", () => {
    const deals = [deal({ status: "delivered" })];
    const ins = coach(salesPlan, deals, "automotive", NOW);
    expect(texts(ins)).not.toMatch(/sharpen the forecast/);
  });
});

describe("coach() — customer touches due (rule 4)", () => {
  it("counts live deals whose reminder is due today or earlier, names the customers", () => {
    const deals = [
      deal({ status: "working", customer: "Alice", followUpAt: "2025-06-15T08:00:00" }), // due today
      deal({ status: "working", customer: "Bob", followUpAt: "2025-06-10T08:00:00" }), // overdue
      deal({ status: "working", customer: "Zed", followUpAt: "2025-06-20T08:00:00" }), // future → excluded
    ];
    const ins = coach(salesPlan, deals, "automotive", NOW);
    const fu = ins.find((i) => i.kind === "followup");
    expect(fu).toBeTruthy();
    expect(fu!.text).toMatch(/2 customer touches deserve attention today/);
    expect(fu!.text).toContain("Alice");
    expect(fu!.text).toContain("Bob");
    expect(fu!.text).not.toContain("Zed");
  });

  it("ignores follow-ups on delivered or dead deals", () => {
    const deals = [
      deal({ status: "delivered", customer: "Done", followUpAt: "2025-06-10T08:00:00" }),
      deal({ status: "dead", customer: "Gone", followUpAt: "2025-06-10T08:00:00" }),
    ];
    const ins = coach(salesPlan, deals, "automotive", NOW);
    expect(kinds(ins)).not.toContain("followup");
  });
});

describe("coach() — thin pipeline (rule 5)", () => {
  it("warns when fewer than 3 live (un-delivered) deals are in play", () => {
    const deals = [
      deal({ status: "delivered" }),
      deal({ status: "working" }), // only 1 live
    ];
    const ins = coach(salesPlan, deals, "automotive", NOW);
    const thin = ins.find((i) => i.kind === "push" && /Live deal board is light/.test(i.text));
    expect(thin).toBeTruthy();
    expect(thin!.text).toMatch(/\(1 live\)/);
  });

  it("does not warn when the pipeline has 3 or more live deals", () => {
    const deals = [
      deal({ status: "delivered" }),
      deal({ status: "working" }),
      deal({ status: "working" }),
      deal({ status: "pending" }),
    ];
    const ins = coach(salesPlan, deals, "automotive", NOW);
    expect(texts(ins)).not.toMatch(/Live deal board is light/);
  });
});

describe("coach() — momentum (rule 6)", () => {
  it("reports earned + likely when there's no higher-value 'money' move", () => {
    // flat plan → no grid tiers → no money insight, so momentum should surface
    const deals = [
      deal({ status: "delivered" }),
      deal({ status: "working" }),
      deal({ status: "working" }),
      deal({ status: "pending" }),
    ];
    const ins = coach(salesPlan, deals, "automotive", NOW);
    expect(kinds(ins)).not.toContain("money");
    const momentum = ins.find((i) => i.kind === "win" && /earned/.test(i.text));
    expect(momentum).toBeTruthy();
    expect(momentum!.text).toMatch(/Likely month-end/);
  });
});

describe("coach() — output contract", () => {
  it("returns at most 5 insights", () => {
    const deals = [
      deal({ status: "delivered", customer: "A", followUpAt: "2025-06-14T08:00:00" }),
      deal({ status: "working", customer: "B", followUpAt: "2025-06-14T08:00:00" }),
    ];
    const ins = coach(gridPlan, deals, "automotive", NOW);
    expect(ins.length).toBeLessThanOrEqual(5);
    expect(ins.length).toBeGreaterThan(0);
  });

  it("never throws on an empty deal list and still respects the goal", () => {
    const ins = coach(salesPlan, [], "automotive", NOW);
    expect(Array.isArray(ins)).toBe(true);
    // thin pipeline (0 live) should always fire
    expect(texts(ins)).toMatch(/Live deal board is light/);
  });
});

describe("todaysMission()", () => {
  it("leads with the best grid opportunity when one exists", () => {
    const deals = [deal({ status: "delivered", secondary: 1000, addons: 2 })];
    const msg = todaysMission(gridPlan, deals, "automotive", NOW);
    expect(msg).toMatch(/best money opportunity today/);
  });

  it("falls back to closing the unit gap when behind goal with no grid move", () => {
    const deals = [deal({ status: "delivered" })];
    const msg = todaysMission(salesPlan, deals, "automotive", NOW);
    expect(msg).toMatch(/still in range of 15 vehicles/);
  });

  it("defaults to a protect-your-pace message when at/above goal", () => {
    const deals = Array.from({ length: 8 }, () => deal({ status: "delivered" }));
    const msg = todaysMission(salesPlan, deals, "automotive", NOW);
    expect(msg).toMatch(/good lane/);
  });
});

describe("forecast() — F&I grid pays on retail cars, not DNQ (July 23)", () => {
  it("a no-qualify (DNQ) car does not drag the grid PVR below the real F&I PVR", () => {
    // 3 retail cars at $1,733 F&I each + one no-qualify car ($0 F&I).
    const deals = [
      deal({ status: "delivered", secondary: 1733, addons: 2 }),
      deal({ status: "delivered", secondary: 1733, addons: 2 }),
      deal({ status: "delivered", secondary: 1733, addons: 2 }),
      deal({ status: "delivered", secondary: 0, addons: 0, noQualify: true }),
    ];
    const f = forecast(kennesawFinancePlan(), deals, NOW);
    // Grid PVR must read the retail average ($1,733), NOT 3×1733/4 = $1,300.
    expect(f.current.rateBreakdown?.pvr).toBe(1733);
    // The car COUNT still includes the DNQ delivery (4 cars sold).
    expect(f.counted.length).toBe(4);
  });
});
