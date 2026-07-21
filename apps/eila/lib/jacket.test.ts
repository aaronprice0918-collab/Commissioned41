import { describe, expect, it } from "vitest";
import { DEFAULT_JACKET_ORDER, jacketOrderFor, matchDocLabel, normalizeJacketOrder, orderScannedPages } from "./jacket";

const ORDER = ["Buyer's Order", "Retail Installment Contract", "GAP Waiver", "Odometer Disclosure"];

describe("jacketOrderFor", () => {
  it("falls back to the house default when unset or empty", () => {
    expect(jacketOrderFor(null)).toBe(DEFAULT_JACKET_ORDER);
    expect(jacketOrderFor({})).toBe(DEFAULT_JACKET_ORDER);
    expect(jacketOrderFor({ jacketOrder: [] })).toBe(DEFAULT_JACKET_ORDER);
    expect(jacketOrderFor({ jacketOrder: ["  ", ""] })).toBe(DEFAULT_JACKET_ORDER);
  });

  it("uses the saved order, trimmed", () => {
    expect(jacketOrderFor({ jacketOrder: [" Buyer's Order ", "Contract", ""] })).toEqual(["Buyer's Order", "Contract"]);
  });
});

describe("normalizeJacketOrder", () => {
  it("trims, drops empties, dedupes case-insensitively", () => {
    expect(normalizeJacketOrder("Buyer's Order\n\n  Contract  \nbuyer's order\nTitle App")).toEqual([
      "Buyer's Order",
      "Contract",
      "Title App",
    ]);
  });
});

describe("matchDocLabel", () => {
  it("snaps exact and fuzzy labels onto the order", () => {
    expect(matchDocLabel("Buyer's Order", ORDER)).toBe("Buyer's Order");
    expect(matchDocLabel("buyers order", ORDER)).toBe("Buyer's Order");
    expect(matchDocLabel("GAP", ORDER)).toBe("GAP Waiver");
    expect(matchDocLabel("Odometer Disclosure Statement", ORDER)).toBe("Odometer Disclosure");
    expect(matchDocLabel("Random Flyer", ORDER)).toBe("Unknown");
    expect(matchDocLabel("", ORDER)).toBe("Unknown");
  });
});

describe("orderScannedPages", () => {
  it("groups pages by doc in the user's order", () => {
    const plan = orderScannedPages(
      [
        { page: 0, doc: "GAP Waiver" },
        { page: 1, doc: "Buyer's Order" },
        { page: 2, doc: "Buyer's Order" },
        { page: 3, doc: "Retail Installment Contract" },
        { page: 4, doc: "GAP Waiver" },
      ],
      ORDER
    );
    expect(plan.sequence).toEqual([1, 2, 3, 0, 4]);
    expect(plan.found).toEqual(["Buyer's Order", "Retail Installment Contract", "GAP Waiver"]);
    expect(plan.unknownPages).toEqual([]);
  });

  it("keeps every unplaced page at the back — nothing vanishes", () => {
    const plan = orderScannedPages(
      [
        { page: 0, doc: "mystery" },
        { page: 1, doc: "Buyer's Order" },
        { page: 2, doc: "" },
      ],
      ORDER
    );
    expect(plan.sequence).toEqual([1, 0, 2]);
    expect(plan.groups.at(-1)).toEqual({ doc: "Unknown", pages: [0, 2] });
    expect([...plan.sequence].sort()).toEqual([0, 1, 2]);
  });
});
