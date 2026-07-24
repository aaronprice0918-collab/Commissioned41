import { describe, it, expect } from "vitest";
import { auditDeals, auditSummary, patchForFinding } from "./selfAudit";
import type { Deal, DealStatus, Profile } from "./types";

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
    amount: 20000,
    secondary: 1800,
    addons: 2,
    reserve: 400,
    ...p,
  };
}

// A profile whose menu HAS a VSC (the normal case) — no menu warning.
const profile = { industry: "automotive", products: [{ id: "vsc", label: "VSC", units: 1, spiff: 0 }] } as unknown as Profile;

describe("EILA self-audit — she catches miscounted deals herself", () => {
  it("flags a $0-F&I, no-product delivered deal as a house/no-qualify deal", () => {
    const deals = [
      deal({ status: "delivered" }),
      deal({ status: "delivered", secondary: 0, addons: 0, reserve: 0, products: [], customer: "House Deal" }),
    ];
    const r = auditDeals(deals, profile, NOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe("markNoQualify");
    expect(r.findings[0].customer).toBe("House Deal");
    expect(r.unitsNow).toBe(2);
    expect(r.unitsAfter).toBe(1);
  });

  it("flags back-end money with no vehicle as product-only", () => {
    const deals = [
      deal({ status: "delivered" }),
      deal({ status: "delivered", amount: 0, item: "VSC — product only", secondary: 900, reserve: 0, customer: "Walk-in" }),
    ];
    const r = auditDeals(deals, profile, NOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].kind).toBe("markProductOnly");
    expect(r.unitsAfter).toBe(1);
  });

  it("stays quiet on a clean month — no false alarms", () => {
    const deals = [deal({ status: "delivered" }), deal({ status: "delivered" }), deal({ status: "delivered" })];
    const r = auditDeals(deals, profile, NOW);
    expect(r.findings).toHaveLength(0);
    expect(r.unitsNow).toBe(3);
    expect(r.unitsAfter).toBe(3);
    expect(auditSummary(r)).toContain("check out");
  });

  it("never re-flags deals that are ALREADY tagged", () => {
    const deals = [
      deal({ status: "delivered", secondary: 0, addons: 0, reserve: 0, products: [], noQualify: true }),
      deal({ status: "delivered", amount: 0, item: "product only", secondary: 900, productOnly: true }),
    ];
    expect(auditDeals(deals, profile, NOW).findings).toHaveLength(0);
  });

  it("does NOT flag an F&I user's ordinary deal just because amount is 0", () => {
    // F&I managers log back gross only — amount 0 is normal, not product-only.
    const deals = [deal({ status: "delivered", amount: 0, secondary: 1800, item: "CX-5" })];
    expect(auditDeals(deals, profile, NOW).findings).toHaveLength(0);
  });

  it("does NOT flag a flat/mini deal that still sold a product", () => {
    const deals = [deal({ status: "delivered", secondary: 0, addons: 1, reserve: 0, products: ["vsc"] })];
    expect(auditDeals(deals, profile, NOW).findings).toHaveLength(0);
  });

  it("ignores pipeline, other months, and demo seed data", () => {
    const zero = { secondary: 0, addons: 0, reserve: 0, products: [] as string[] };
    const deals = [
      deal({ status: "working", ...zero }),
      deal({ status: "delivered", date: "2025-05-05T10:00:00", ...zero }),
      deal({ status: "delivered", demo: true, ...zero }),
    ];
    expect(auditDeals(deals, profile, NOW).findings).toHaveLength(0);
  });

  it("warns when the product menu has no findable VSC (the 0%-penetration trap)", () => {
    const noVsc = { industry: "automotive", products: [{ id: "gap", label: "GAP", units: 1, spiff: 0 }] } as unknown as Profile;
    const r = auditDeals([deal({ status: "delivered" })], noVsc, NOW);
    expect(r.vscMenuWarning).toContain("VSC");
  });

  it("reproduces Aaron's July shape: 41 counted → 36 after the fix", () => {
    const deals: Deal[] = [];
    for (let i = 0; i < 36; i++) deals.push(deal({ status: "delivered", products: ["vsc"] }));
    for (let i = 0; i < 3; i++) deals.push(deal({ status: "delivered", secondary: 0, addons: 0, reserve: 0, products: [] }));
    for (let i = 0; i < 2; i++) deals.push(deal({ status: "delivered", amount: 0, item: "product only", secondary: 1000, reserve: 0 }));

    const r = auditDeals(deals, profile, NOW);
    expect(r.findings).toHaveLength(5);
    expect(r.unitsNow).toBe(41);
    expect(r.unitsAfter).toBe(36);
    expect(auditSummary(r)).toContain("41 to 36");
  });

  it("a fix only ever changes classification — never a gross amount", () => {
    expect(patchForFinding("markProductOnly")).toEqual({ productOnly: true });
    // no-qualify zeroes F&I credit to match how the LOGG importer records a DNQ
    expect(patchForFinding("markNoQualify")).toEqual({ noQualify: true, secondary: 0 });
  });
});
