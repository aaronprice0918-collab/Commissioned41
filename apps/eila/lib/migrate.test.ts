// Migration safety net for live customer data: deals saved under the
// automotive-era field names must load losslessly into the industry-neutral
// model — and already-migrated data must pass through untouched.
import { describe, expect, it } from "vitest";
import { ensureDeals } from "./migrate";
import type { AppData, Deal } from "./types";

const base = { profile: null, deals: [] as Deal[] };

describe("ensureDeals()", () => {
  it("maps every legacy automotive field onto the neutral model", () => {
    const legacy = {
      ...base,
      deals: [
        {
          id: "d1", date: "2026-06-15T12:00:00Z", customer: "Marcus Bell",
          vehicle: "CX-5", type: "new", frontGross: 1850, backGross: 1400,
          products: 2, reserve: 700, status: "delivered",
          followUpAt: "2026-06-20T12:00:00Z", note: "repeat buyer", demo: true,
        } as unknown as Deal,
      ],
    } satisfies AppData;

    const d = ensureDeals(legacy).deals[0];
    expect(d.item).toBe("CX-5");
    expect(d.category).toBe("new");
    expect(d.amount).toBe(1850);
    expect(d.secondary).toBe(1400);
    expect(d.addons).toBe(2);
    expect(d.reserve).toBe(700);
    // untouched fields survive
    expect(d.customer).toBe("Marcus Bell");
    expect(d.status).toBe("delivered");
    expect(d.followUpAt).toBe("2026-06-20T12:00:00Z");
    expect(d.note).toBe("repeat buyer");
    expect(d.demo).toBe(true);
    // legacy keys are gone (no zombie data riding along)
    expect((d as unknown as Record<string, unknown>).vehicle).toBeUndefined();
    expect((d as unknown as Record<string, unknown>).frontGross).toBeUndefined();
  });

  it("fills safe defaults for sparse legacy pipeline deals", () => {
    const legacy = {
      ...base,
      deals: [{ id: "d2", date: "2026-06-15T12:00:00Z", customer: "Gloria", vehicle: "", type: "used", frontGross: 0, backGross: 0, products: 0, reserve: 0, status: "working" } as unknown as Deal],
    } satisfies AppData;
    const d = ensureDeals(legacy).deals[0];
    expect(d.item).toBe("");
    expect(d.amount).toBe(0);
    expect(d.secondary).toBe(0);
    expect(d.addons).toBe(0);
  });

  it("passes already-migrated deals through unchanged (same reference)", () => {
    const modern: AppData = {
      ...base,
      deals: [{ id: "d3", date: "2026-06-15T12:00:00Z", customer: "Priya", item: "88 Lakeview Dr", category: "listing", amount: 9800, secondary: 0, addons: 0, reserve: 0, status: "pending" }],
    };
    expect(ensureDeals(modern)).toBe(modern);
  });
});

// F&I regression: the modern products LIST must never be mistaken for the
// legacy products COUNT and stripped on load.
import { ensureDeals as ensureDeals2 } from "./migrate";
describe("ensureDeals - F&I products list", () => {
  it("passes modern deals with a products array through untouched", () => {
    const data = {
      profile: null,
      deals: [{ id: "1", date: "2026-07-01", customer: "C", item: "26 CX-5", amount: 1, secondary: 2, addons: 7, reserve: 0, status: "delivered", products: ["vsc", "nas"], salesperson: "Noel" }],
    } as never;
    const out = ensureDeals2(data);
    expect(out).toBe(data); // same reference = untouched
  });
  it("still converts a legacy numeric products count to addons", () => {
    const data = {
      profile: null,
      deals: [{ id: "1", date: "2026-06-01", customer: "C", vehicle: "CX-5", frontGross: 100, backGross: 200, products: 3, status: "delivered" }],
    } as never;
    const out = ensureDeals2(data) as { deals: { addons: number; products?: unknown }[] };
    expect(out.deals[0].addons).toBe(3);
    expect(out.deals[0].products).toBeUndefined();
  });
});
