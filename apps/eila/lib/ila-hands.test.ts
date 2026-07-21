import { describe, expect, it, vi } from "vitest";
import { executeIlaTool } from "./ila-hands";
import type { Deal, Profile } from "./types";

const profile = {
  name: "A", role: "finance", industry: "automotive", createdAt: "",
  plan: {} as never,
  products: [
    { id: "vsc", label: "VSC", units: 1, spiff: 40 },
    { id: "nas", label: "NAS Combo", units: 5, spiff: 50 },
  ],
} as unknown as Profile;

const deals: Deal[] = [
  { id: "d1", date: "2026-07-02T12:00:00Z", customer: "Karen Dean", item: "26 CX-5", amount: 0, secondary: 2400, addons: 6, reserve: 350, status: "delivered", dealNumber: "1562", products: ["vsc", "nas"] },
  { id: "d2", date: "2026-07-03T12:00:00Z", customer: "Karen Smith", item: "26 CX-30", amount: 0, secondary: 500, addons: 0, reserve: 0, status: "delivered", dealNumber: "1570" },
];

function ctx(over: Partial<Parameters<typeof executeIlaTool>[1]> = {}) {
  return {
    profile, deals, memories: [],
    updateDaysOff: vi.fn(), updateProducts: vi.fn(), updateDeal: vi.fn(), updateMoney: vi.fn(), updatePlan: vi.fn(),
    addDeal: vi.fn(), addDeals: vi.fn(), importDeals: vi.fn(() => ({ added: 0, updated: 0 })), removeDeal: vi.fn(), addLifeItem: vi.fn(), clearSampleData: vi.fn(), forgetIlaMemory: vi.fn(),
    ...over,
  };
}

const moneyProfile = {
  ...profile,
  plan: { version: 1, role: "finance", type: "flat", base: { salary: 0, frontPct: 0, backPct: 20, perUnit: 0, perProduct: 0, basis: "back" }, tiers: [], bonuses: [], deductions: [], penalties: [], goalUnits: 10, unsupported: [], confidence: 1 },
  money: {
    checkingBalance: 5000, payday: 15, monthlyEssentials: 900,
    bills: [{ id: "rent", name: "Rent", amount: 1800, cadence: "monthly", dayOfMonth: 1 }],
    goals: [{ id: "g1", name: "Emergency fund", target: 10000, saved: 4000 }],
  },
} as unknown as Profile;

describe("EILA hands", () => {
  it("sets a take-home dollar goal and a unit goal on the pay plan", async () => {
    const c = ctx({ profile: moneyProfile });
    const r = await executeIlaTool({ id: "g", name: "set_pay_goal", input: { takeHome: 20000, units: 50 } }, c);
    expect(c.updatePlan).toHaveBeenCalledWith(expect.objectContaining({ takeHomeGoal: 20000, goalUnits: 50 }));
    expect(r.content).toContain("$20,000 take-home");
    expect(r.isError).toBeUndefined();
  });

  it("sets days off and reports the day names", async () => {
    const c = ctx();
    const r = await executeIlaTool({ id: "t1", name: "set_days_off", input: { days: [0, 2] } }, c);
    expect(c.updateDaysOff).toHaveBeenCalledWith([0, 2]);
    expect(r.content).toContain("Sunday + Tuesday");
    expect(r.isError).toBeUndefined();
  });

  it("refuses to mark every day off", async () => {
    const r = await executeIlaTool({ id: "t1", name: "set_days_off", input: { days: [0,1,2,3,4,5,6] } }, ctx());
    expect(r.isError).toBe(true);
  });

  it("adds a life item to the EILA Day board", async () => {
    const c = ctx();
    const r = await executeIlaTool({
      id: "life1",
      name: "add_life_item",
      input: { title: "Dentist appointment", kind: "appointment", date: "2026-07-15", time: "9:30", note: "bring insurance card" },
    }, c);
    expect(c.addLifeItem).toHaveBeenCalledWith({
      title: "Dentist appointment",
      kind: "appointment",
      date: "2026-07-15",
      time: "09:30",
      note: "bring insurance card",
    });
    expect(r.friendly).toContain("Added to day");
    expect(r.isError).toBeUndefined();
  });

  it("updates a deal by deal number, resolving product names and recomputing units", async () => {
    const c = ctx();
    const r = await executeIlaTool({ id: "t2", name: "update_deal", input: { deal: "1570", changes: { products_add: ["NAS Combo"], secondary: 800 } } }, c);
    expect(r.isError).toBeUndefined();
    expect(c.updateDeal).toHaveBeenCalledWith("d2", expect.objectContaining({ secondary: 800, products: ["nas"], addons: 5 }));
  });

  it("asks instead of guessing when two customers match", async () => {
    const r = await executeIlaTool({ id: "t3", name: "update_deal", input: { deal: "karen", changes: { funded: true } } }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Multiple deals match");
  });

  it("rejects unknown products with the real menu listed", async () => {
    const r = await executeIlaTool({ id: "t4", name: "update_deal", input: { deal: "1562", changes: { products_add: ["Tire Shine Deluxe"] } } }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toContain("VSC");
  });

  it("updates money basics and stamps balanceAsOf", async () => {
    const c = ctx({ profile: moneyProfile });
    const r = await executeIlaTool({ id: "m1", name: "update_money", input: { checking_balance: 6400, payday: 20 } }, c);
    expect(r.isError).toBeUndefined();
    expect(c.updateMoney).toHaveBeenCalledWith(expect.objectContaining({ checkingBalance: 6400, payday: 20, balanceAsOf: expect.any(String) }));
  });

  it("upsert_bill edits an existing bill by partial name without duplicating", async () => {
    const c = ctx({ profile: moneyProfile });
    const r = await executeIlaTool({ id: "m2", name: "upsert_bill", input: { name: "rent", amount: 1900 } }, c);
    expect(r.isError).toBeUndefined();
    const arg = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.bills.length).toBe(1);
    expect(arg.bills[0]).toMatchObject({ id: "rent", name: "Rent", amount: 1900 });
  });

  it("upsert_bill adds a new bill and remove deletes one", async () => {
    const c = ctx({ profile: moneyProfile });
    await executeIlaTool({ id: "m3", name: "upsert_bill", input: { name: "State Farm", amount: 210, day_of_month: 22 } }, c);
    let arg = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.bills.length).toBe(2);
    const c2 = ctx({ profile: moneyProfile });
    const r = await executeIlaTool({ id: "m4", name: "upsert_bill", input: { name: "rent", remove: true } }, c2);
    expect(r.isError).toBeUndefined();
    arg = (c2.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.bills.length).toBe(0);
  });

  it("update_goal add_to_saved accumulates and celebrates at 100%", async () => {
    const c = ctx({ profile: moneyProfile });
    const r = await executeIlaTool({ id: "m5", name: "update_goal", input: { name: "emergency", add_to_saved: 6000 } }, c);
    expect(r.isError).toBeUndefined();
    const arg = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.goals[0].saved).toBe(10000);
    expect(r.content).toContain("GOAL HIT");
  });

  it("update_goal requires a target when creating a new goal", async () => {
    const r = await executeIlaTool({ id: "m6", name: "update_goal", input: { name: "Boat" } }, ctx({ profile: moneyProfile }));
    expect(r.isError).toBe(true);
  });

  it("evaluate_purchase returns verdict data when money is set up", async () => {
    const c = ctx({ profile: moneyProfile });
    const r = await executeIlaTool({ id: "m7", name: "evaluate_purchase", input: { amount: 400, label: "golf clubs" } }, c);
    expect(r.isError).toBeUndefined();
    expect(r.content).toMatch(/CLEAR|TIGHT|NO/);
    expect(r.content).toContain("golf clubs");
  });

  it("evaluate_purchase refuses honestly when money is not set up", async () => {
    const r = await executeIlaTool({ id: "m8", name: "evaluate_purchase", input: { amount: 400 } }, ctx());
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Money tab");
  });
});

describe("EILA hands — budget (log_spend / set_budget)", () => {
  const budgetProfile = {
    ...moneyProfile,
    money: {
      ...(moneyProfile as unknown as { money: Record<string, unknown> }).money,
      budgets: [{ name: "Food", monthly: 350 }],
      spend: [],
    },
  } as unknown as Profile;

  it("logs a purchase, snapping to the existing category's casing", async () => {
    const c = ctx({ profile: budgetProfile });
    const r = await executeIlaTool({ id: "t1", name: "log_spend", input: { amount: 47, category: "food", note: "lunch" } }, c);
    expect(r.isError).toBeUndefined();
    const saved = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.spend).toHaveLength(1);
    expect(saved.spend[0]).toMatchObject({ amount: 47, category: "Food", note: "lunch" });
    expect(r.content).toContain("$303"); // 350 − 47 left in Food
  });

  it("flags unplanned categories and rejects a missing amount", async () => {
    const c = ctx({ profile: budgetProfile });
    const r = await executeIlaTool({ id: "t2", name: "log_spend", input: { amount: 99, category: "Golf" } }, c);
    expect(r.content).toContain("unplanned");
    const bad = await executeIlaTool({ id: "t3", name: "log_spend", input: { category: "Food" } }, c);
    expect(bad.isError).toBe(true);
  });

  it("sets and removes a budget category", async () => {
    const c = ctx({ profile: budgetProfile });
    const r = await executeIlaTool({ id: "t4", name: "set_budget", input: { category: "Gas", monthly: 120 } }, c);
    expect(r.isError).toBeUndefined();
    const saved = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Gas", monthly: 120 }),
      expect.objectContaining({ name: "Food", monthly: 350 }),
    ]));

    const rm = await executeIlaTool({ id: "t5", name: "set_budget", input: { category: "food", remove: true } }, c);
    expect(rm.isError).toBeUndefined();
    const afterRemove = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(afterRemove.budgets).toHaveLength(0);

    const miss = await executeIlaTool({ id: "t6", name: "set_budget", input: { category: "Boats", remove: true } }, c);
    expect(miss.isError).toBe(true);
  });
});

describe("EILA hands — remove_spend (returned purchases, test entries)", () => {
  const logProfile = {
    ...moneyProfile,
    money: {
      ...(moneyProfile as unknown as { money: Record<string, unknown> }).money,
      budgets: [{ name: "Shopping", monthly: 300 }],
      spend: [
        { id: "e1", date: "2026-07-07", amount: 450, category: "Shopping", note: "test entry" },
        { id: "e2", date: "2026-07-07", amount: 65, category: "Food", note: "test entry" },
        { id: "e3", date: "2026-07-05", amount: 65, category: "Food" },
      ],
    },
  } as unknown as Profile;

  it("removes a uniquely-matched entry and reports the new budget state", async () => {
    const c = ctx({ profile: logProfile });
    const r = await executeIlaTool({ id: "t1", name: "remove_spend", input: { amount: 450, category: "shopping" } }, c);
    expect(r.isError).toBeUndefined();
    const saved = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.spend.map((e: { id: string }) => e.id)).toEqual(["e2", "e3"]);
    expect(r.content).toContain("Removed");
  });

  it("lists candidates instead of guessing when several match", async () => {
    const c = ctx({ profile: logProfile });
    const r = await executeIlaTool({ id: "t2", name: "remove_spend", input: { amount: 65 } }, c);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("2 entries match");
    expect(c.updateMoney).not.toHaveBeenCalled();
    // disambiguate by entry_id
    const r2 = await executeIlaTool({ id: "t3", name: "remove_spend", input: { entry_id: "e2" } }, c);
    expect(r2.isError).toBeUndefined();
  });

  it("shows the recent log when nothing matches", async () => {
    const r = await executeIlaTool({ id: "t4", name: "remove_spend", input: { amount: 9999 } }, ctx({ profile: logProfile }));
    expect(r.isError).toBe(true);
    expect(r.content).toContain("Recent log");
  });

  it("update_money accepts a separate savings balance", async () => {
    const c = ctx({ profile: logProfile });
    const r = await executeIlaTool({ id: "t5", name: "update_money", input: { savings_balance: 1820 } }, c);
    expect(r.isError).toBeUndefined();
    const saved = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.savingsBalance).toBe(1820);
  });
});

describe("EILA hands — July 8 parity tools", () => {
  it("log_deal: logs a delivered deal with resolved products and computed units", async () => {
    const c = ctx();
    const r = await executeIlaTool({ id: "l1", name: "log_deal", input: { customer: "The Hendersons", amount: 2000, secondary: 1500, products: ["vsc", "NAS"] } }, c);
    expect(c.addDeal).toHaveBeenCalledWith(expect.objectContaining({
      customer: "The Hendersons", status: "delivered", amount: 2000, secondary: 1500,
      products: ["vsc", "nas"], addons: 6, // VSC 1u + NAS Combo 5u
    }));
    expect(r.isError).toBeUndefined();
    expect(r.friendly).toContain("Logged: The Hendersons");
  });

  it("log_deal: pipeline add with a follow-up date; rejects unknown products and bad statuses", async () => {
    const c = ctx();
    const r = await executeIlaTool({ id: "l2", name: "log_deal", input: { customer: "Tony Vega", status: "appointment", follow_up_date: "2026-07-12" } }, c);
    expect(c.addDeal).toHaveBeenCalledWith(expect.objectContaining({ customer: "Tony Vega", status: "appointment", followUpAt: expect.stringContaining("2026-07-12") }));
    expect(r.isError).toBeUndefined();
    const bad = await executeIlaTool({ id: "l3", name: "log_deal", input: { customer: "X", products: ["Moon Roof Wax"] } }, ctx());
    expect(bad.isError).toBe(true);
    const dead = await executeIlaTool({ id: "l4", name: "log_deal", input: { customer: "X", status: "dead" } }, ctx());
    expect(dead.isError).toBe(true);
    const anon = await executeIlaTool({ id: "l5", name: "log_deal", input: {} }, ctx());
    expect(anon.isError).toBe(true);
  });

  it("import_deals: lands a pasted LOGG month at once, mapping columns + products", async () => {
    const c = ctx();
    const csv = [
      "Date,Customer,Salesperson,Front,F&I,VSC,NAS Combo",
      "7/2,Jane Doe,Rodney,1200,1850,x,x",
      "7/5,Bob Ray,Alex,0,2100,,x",
      "TOTAL,,,,3950,,",
    ].join("\n");
    const c2 = ctx({ importDeals: vi.fn(() => ({ added: 2, updated: 0 })) });
    const r = await executeIlaTool({ id: "i1", name: "import_deals", input: { csv } }, c2);
    expect(c2.importDeals).toHaveBeenCalledTimes(1);
    const imported = (c2.importDeals as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(imported).toHaveLength(2); // TOTAL row skipped
    expect(imported[0]).toEqual(expect.objectContaining({
      customer: "Jane Doe", secondary: 1850, products: ["vsc", "nas"], status: "delivered", funded: true,
    }));
    expect(r.isError).toBeUndefined();
    expect(r.friendly).toContain("2 added");
    expect(r.content).toContain("skipped 1");
  });

  it("import_deals: empty paste is a clean error, not a crash", async () => {
    const r = await executeIlaTool({ id: "i2", name: "import_deals", input: { csv: "   " } }, ctx());
    expect(r.isError).toBe(true);
  });

  it("delete_deal: previews first, deletes only on confirm; ambiguous name asks instead of guessing", async () => {
    // First call (no confirm) must PREVIEW, not delete.
    const c = ctx();
    const preview = await executeIlaTool({ id: "x1", name: "delete_deal", input: { deal: "1570" } }, c);
    expect(c.removeDeal).not.toHaveBeenCalled();
    expect(preview.isError).toBeUndefined();
    expect(preview.content).toContain("About to permanently delete");
    // Second call with confirm=true actually deletes.
    const confirmed = await executeIlaTool({ id: "x1b", name: "delete_deal", input: { deal: "1570", confirm: true } }, c);
    expect(c.removeDeal).toHaveBeenCalledWith("d2");
    expect(confirmed.friendly).toContain("Deleted Karen Smith");
    // Ambiguous never deletes, even with confirm.
    const c2 = ctx();
    const ambiguous = await executeIlaTool({ id: "x2", name: "delete_deal", input: { deal: "karen", confirm: true } }, c2);
    expect(ambiguous.isError).toBe(true);
    expect(c2.removeDeal).not.toHaveBeenCalled();
  });

  it("update_deal: can revive a dead deal (dead deals are matchable now) and rejects invalid statuses", async () => {
    const deadDeal: Deal = { id: "d9", date: "2026-07-05T12:00:00Z", customer: "Lost Lead", item: "", amount: 0, secondary: 0, addons: 0, reserve: 0, status: "dead" };
    const c = ctx({ deals: [...deals, deadDeal] });
    const r = await executeIlaTool({ id: "u1", name: "update_deal", input: { deal: "Lost Lead", changes: { status: "working" } } }, c);
    expect(c.updateDeal).toHaveBeenCalledWith("d9", expect.objectContaining({ status: "working" }));
    expect(r.isError).toBeUndefined();
    const bad = await executeIlaTool({ id: "u2", name: "update_deal", input: { deal: "Karen Dean", changes: { status: "sold!!" } } }, ctx());
    expect(bad.isError).toBe(true);
  });

  it("update_plan_config: sets tax/draw/carried-in and reclassifies; rejects out-of-range values", async () => {
    const c = ctx({ profile: moneyProfile });
    const r = await executeIlaTool({ id: "p1", name: "update_plan_config", input: { tax_rate: 24, draw: 8000, draw_carried_in: 1500 } }, c);
    expect(c.updatePlan).toHaveBeenCalledWith(expect.objectContaining({
      taxRate: 24,
      draw: expect.objectContaining({ amount: 8000, recoverable: true }),
      drawCarriedIn: 1500,
    }));
    expect(r.isError).toBeUndefined();
    const bad = await executeIlaTool({ id: "p2", name: "update_plan_config", input: { tax_rate: 150 } }, ctx({ profile: moneyProfile }));
    expect(bad.isError).toBe(true);
    const empty = await executeIlaTool({ id: "p3", name: "update_plan_config", input: {} }, ctx({ profile: moneyProfile }));
    expect(empty.isError).toBe(true);
  });

  it("update_plan_config: draw 0 removes the draw", async () => {
    const c = ctx({ profile: moneyProfile });
    await executeIlaTool({ id: "p4", name: "update_plan_config", input: { draw: 0 } }, c);
    expect(c.updatePlan).toHaveBeenCalledWith(expect.objectContaining({ draw: undefined }));
  });

  it("clear_sample_data: clears when demo deals exist, errors honestly when none", async () => {
    const demoDeals = [{ ...deals[0], id: "dd", demo: true }];
    const c = ctx({ deals: demoDeals });
    const r = await executeIlaTool({ id: "s1", name: "clear_sample_data", input: {} }, c);
    expect(c.clearSampleData).toHaveBeenCalled();
    expect(r.isError).toBeUndefined();
    const none = await executeIlaTool({ id: "s2", name: "clear_sample_data", input: {} }, ctx());
    expect(none.isError).toBe(true);
  });

  it("forget_memory: unique match forgets; multiple matches ask with ids; id disambiguates", async () => {
    const memories = [
      { id: "m1", date: "", note: "Works Saturdays, off Mondays" },
      { id: "m2", date: "", note: "Prefers direct coaching" },
      { id: "m3", date: "", note: "Direct with customers too" },
    ];
    const c = ctx({ memories });
    const r = await executeIlaTool({ id: "f1", name: "forget_memory", input: { contains: "Saturdays" } }, c);
    expect(c.forgetIlaMemory).toHaveBeenCalledWith("m1");
    expect(r.isError).toBeUndefined();
    const multi = await executeIlaTool({ id: "f2", name: "forget_memory", input: { contains: "direct" } }, ctx({ memories }));
    expect(multi.isError).toBe(true);
    expect(multi.content).toContain("m2");
    const byId = ctx({ memories });
    await executeIlaTool({ id: "f3", name: "forget_memory", input: { contains: "m3" } }, byId);
    expect(byId.forgetIlaMemory).toHaveBeenCalledWith("m3");
  });
});

describe("upsert_bill duplicate-name disambiguation (July 13 field report)", () => {
  const dupProfile = {
    ...profile,
    plan: { version: 1, role: "finance", type: "flat", base: { salary: 0, frontPct: 0, backPct: 20, perUnit: 0, perProduct: 0, basis: "back" }, tiers: [], bonuses: [], deductions: [], penalties: [], goalUnits: 10, unsupported: [], confidence: 1 },
    money: {
      checkingBalance: 5000, payday: 15, monthlyEssentials: 900,
      bills: [
        { id: "r1", name: "Rent", amount: 1300, cadence: "monthly", dayOfMonth: 16 },
        { id: "r2", name: "Rent", amount: 1300, cadence: "monthly", dayOfMonth: 30 },
      ],
      goals: [],
    },
  } as unknown as Profile;

  it("narrows by match_day to edit one of two same-name bills", async () => {
    const c = ctx({ profile: dupProfile });
    const r = await executeIlaTool({ id: "d1", name: "upsert_bill", input: { name: "rent", match_day: 16, amount: 1330 } }, c);
    expect(r.isError).toBeUndefined();
    const arg = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.bills.find((b: { id: string }) => b.id === "r1").amount).toBe(1330);
    expect(arg.bills.find((b: { id: string }) => b.id === "r2").amount).toBe(1300);
  });

  it("narrows by match_amount after one twin diverges", async () => {
    const diverged = { ...dupProfile, money: { ...(dupProfile as unknown as { money: object }).money, bills: [
      { id: "r1", name: "Rent", amount: 1330, cadence: "monthly", dayOfMonth: 16 },
      { id: "r2", name: "Rent", amount: 1300, cadence: "monthly", dayOfMonth: 30 },
    ] } } as unknown as Profile;
    const c = ctx({ profile: diverged });
    const r = await executeIlaTool({ id: "d2", name: "upsert_bill", input: { name: "rent", match_amount: 1300, amount: 1503 } }, c);
    expect(r.isError).toBeUndefined();
    const arg = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.bills.find((b: { id: string }) => b.id === "r2").amount).toBe(1503);
  });

  it("identical twins: edit targets the first instead of dead-ending", async () => {
    const twins = { ...dupProfile, money: { ...(dupProfile as unknown as { money: object }).money, bills: [
      { id: "r1", name: "Rent", amount: 1300, cadence: "monthly", dayOfMonth: 16 },
      { id: "r2", name: "Rent", amount: 1300, cadence: "monthly", dayOfMonth: 16 },
    ] } } as unknown as Profile;
    const c = ctx({ profile: twins });
    const r = await executeIlaTool({ id: "d3", name: "upsert_bill", input: { name: "rent", remove: true } }, c);
    expect(r.isError).toBeUndefined();
    const arg = (c.updateMoney as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.bills.length).toBe(1);
  });

  it("distinct duplicates without hints get a message that teaches the fix", async () => {
    const c = ctx({ profile: dupProfile });
    const r = await executeIlaTool({ id: "d4", name: "upsert_bill", input: { name: "rent", amount: 1400 } }, c);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("match_amount");
    expect(r.content).toContain("on the 16");
  });
});
