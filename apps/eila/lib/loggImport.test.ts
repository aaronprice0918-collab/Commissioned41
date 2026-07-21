import { describe, it, expect } from "vitest";
import {
  parseCsv,
  mapColumns,
  parseMoney,
  cellIsSold,
  parseLoggDate,
  parseLoggCsv,
  reconcileImport,
} from "./loggImport";
import { DEFAULT_AUTO_PRODUCTS } from "./fni";
import type { Deal, DealStatus } from "./types";

const defs = DEFAULT_AUTO_PRODUCTS;

describe("parseCsv — RFC-4180-ish tokenizer", () => {
  it("splits simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("respects quoted fields with commas and escaped quotes", () => {
    expect(parseCsv('name,note\n"Smith, John","said ""hi"""')).toEqual([
      ["name", "note"],
      ["Smith, John", 'said "hi"'],
    ]);
  });
  it("tolerates tab-separated paste from Google Sheets", () => {
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("drops fully-blank rows", () => {
    expect(parseCsv("a,b\n1,2\n,\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
});

describe("parseMoney — dealership money formats", () => {
  it("strips $ and commas", () => expect(parseMoney("$1,496.50")).toBeCloseTo(1496.5, 5));
  it("reads parenthesized negatives", () => expect(parseMoney("(300)")).toBe(-300));
  it("reads a leading-minus negative", () => expect(parseMoney("-250")).toBe(-250));
  it("blank is 0", () => expect(parseMoney("")).toBe(0));
});

describe("cellIsSold — did this product sell on this row?", () => {
  it("dollar amount or count = sold", () => {
    expect(cellIsSold("$1,200")).toBe(true);
    expect(cellIsSold("1")).toBe(true);
  });
  it("affirmative marks = sold, incl. THE LOGG's ✔ (U+2714)", () => {
    expect(cellIsSold("x")).toBe(true);
    expect(cellIsSold("YES")).toBe(true);
    expect(cellIsSold("✓")).toBe(true);
    expect(cellIsSold("✔")).toBe(true);
  });
  it("blank / 0 / dash / ✘ = not sold", () => {
    expect(cellIsSold("")).toBe(false);
    expect(cellIsSold("0")).toBe(false);
    expect(cellIsSold("-")).toBe(false);
    expect(cellIsSold("no")).toBe(false);
    expect(cellIsSold("✘")).toBe(false); // THE LOGG's "not sold" mark (U+2718)
  });
});

describe("parseLoggDate — the date formats a LOGG carries", () => {
  it("M/D fills the reference year at noon-local", () => {
    expect(parseLoggDate("7/10", 2026)).toBe(new Date("2026-07-10T12:00:00").toISOString());
  });
  it("M/D/YY expands the century", () => {
    expect(parseLoggDate("7/10/26", 2025)).toBe(new Date("2026-07-10T12:00:00").toISOString());
  });
  it("ISO passes through", () => {
    expect(parseLoggDate("2026-07-10", 2000)).toBe(new Date("2026-07-10T12:00:00").toISOString());
  });
  it("garbage is null", () => expect(parseLoggDate("n/a", 2026)).toBeNull());
});

describe("mapColumns — THE LOGG headers → EILA fields and product columns", () => {
  const cols = mapColumns(
    ["Deal #", "Date", "Customer", "Salesperson", "Co-Sales", "Vehicle", "Bank", "Front Gross", "F&I Gross", "Reserve", "VSC", "GAP", "NAS Combo", "Maintenance", "Road Hazard"],
    defs,
  );
  const field = (i: number) => cols[i].field;
  const prod = (i: number) => cols[i].productId;
  it("maps the deal fields", () => {
    expect(field(0)).toBe("dealNumber");
    expect(field(1)).toBe("date");
    expect(field(2)).toBe("customer");
    expect(field(3)).toBe("salesperson");
    expect(field(4)).toBe("salesperson2");
    expect(field(5)).toBe("item");
    expect(field(6)).toBe("bank");
    expect(field(7)).toBe("amount"); // front
    expect(field(8)).toBe("secondary"); // F&I / back
    expect(field(9)).toBe("reserve");
  });
  it("maps the product columns onto the user's menu (incl. NAS→combo, Road Hazard→other)", () => {
    expect(prod(10)).toBe("vsc");
    expect(prod(11)).toBe("gap");
    expect(prod(12)).toBe("combo");
    expect(prod(13)).toBe("maint");
    expect(prod(14)).toBe("other");
  });
});

describe("parseLoggCsv — a month of THE LOGG lands per-deal", () => {
  // Product cells mix dollar amounts and "x" marks — both mean sold. Row 3 is a
  // house/no-qualify deal (carries $0 F&I credit). The TOTAL row is skipped.
  const csv = [
    "Deal #,Date,Customer,Salesperson,Co-Sales,Vehicle,Front,F&I,VSC,GAP,NAS Combo,Maintenance,Road Hazard",
    "1001,7/2,\"Smith, John\",Rodney,,26 CX-5,1200,1850,1200,,x,,",
    "1002,7/5,Jane Doe,Alex,Rodney,25 CX-90,900,2100,x,650,x,300,",
    "1003,7/9,House Deal,Rodney,,24 Mazda3,0,0,,,,,",
    "TOTAL,,,,,,,2100,3950,,,,,",
  ].join("\n");
  const r = parseLoggCsv(csv, defs, { refYear: 2026 });

  it("imports 3 deals and skips the TOTAL row", () => {
    expect(r.deals.length).toBe(3);
    expect(r.skipped).toBe(1);
    expect(r.rowCount).toBe(4);
  });

  it("lands front / back / products on the RIGHT deal", () => {
    const smith = r.deals[0];
    expect(smith.customer).toBe("Smith, John");
    expect(smith.amount).toBe(1200);
    expect(smith.secondary).toBe(1850);
    expect(smith.products).toEqual(["vsc", "combo"]);
    expect(smith.addons).toBe(2); // dealUnits: 2 products × 1 unit
    expect(smith.date).toBe(new Date("2026-07-02T12:00:00").toISOString());
    expect(smith.salesperson).toBe("Rodney");
    expect(smith.item).toBe("26 CX-5");

    const jane = r.deals[1];
    expect(jane.products).toEqual(["vsc", "gap", "combo", "maint"]);
    expect(jane.salesperson2).toBe("Rodney");
    expect(jane.secondary).toBe(2100);
  });

  it("no-qualify/house deal carries $0 F&I credit but keeps the unit", () => {
    const house = r.deals[2];
    expect(house.customer).toBe("House Deal");
    expect(house.secondary).toBe(0);
    expect(house.products ?? []).toEqual([]);
  });

  it("marks imported deals delivered + funded (they're booked on THE LOGG)", () => {
    expect(r.deals.every((d) => d.status === "delivered")).toBe(true);
    expect(r.deals.every((d) => d.funded === true)).toBe(true);
  });

  it("no blocking warnings when customer, back gross, and products all mapped", () => {
    expect(r.warnings).toEqual([]);
  });
});

describe("parseLoggCsv — THE LOGG's real quirks: Adjusted F&I Net, DNQ, Product Units", () => {
  it("uses Adjusted F&I Net (not raw Back Gross) as the finance credit", () => {
    const csv = [
      "Customer,Unit Type,Back Gross,Adjusted F&I Net,Product Units,VSC",
      "Jane,Used,2400,2400,3,✔",
      "House Deal,Do Not Qualify,1400,0,7,✔", // back gross 1400 but adjusted 0
    ].join("\n");
    const r = parseLoggCsv(csv, defs, { refYear: 2026 });
    expect(r.deals[0].secondary).toBe(2400);
    // DNQ row: Adjusted F&I Net is $0 AND it's flagged no-qualify from Unit Type.
    expect(r.deals[1].secondary).toBe(0);
    expect(r.deals[1].noQualify).toBe(true);
  });
  it("flags Unit Type 'Product Only' as productOnly (gross counts, but not a unit)", () => {
    const csv = [
      "Customer,Unit Type,Front Gross,Adjusted F&I Net,VSC",
      "Walk In,Product Only,0,1181,✔",
    ].join("\n");
    const r = parseLoggCsv(csv, defs, { refYear: 2026 });
    expect(r.deals[0].productOnly).toBe(true);
    expect(r.deals[0].secondary).toBe(1181); // back gross still counts (feeds PVR)
    expect(r.deals[0].noQualify).toBeUndefined(); // product-only is not no-qualify
  });
  it("takes Product Units straight from the sheet (a bundle weighs >1) as addons", () => {
    const csv = "Customer,Adjusted F&I Net,Product Units,NAS Combo\nJane,1800,7,✔";
    const r = parseLoggCsv(csv, defs, { refYear: 2026 });
    expect(r.deals[0].addons).toBe(7); // not 1 — THE LOGG's own count wins
  });
  it("maps Unit Type to a category and Funding Status to funded", () => {
    const csv = "Customer,Unit Type,Funding Status,Adjusted F&I Net\nJane,New,Not Funded,1500";
    const r = parseLoggCsv(csv, defs, { refYear: 2026 });
    expect(r.deals[0].category).toBe("new");
    expect(r.deals[0].funded).toBe(false);
  });
});

describe("parseLoggCsv — warns instead of silently dropping money", () => {
  it("flags a missing back-gross column", () => {
    const csv = "Date,Customer,Front\n7/2,Jane,1000";
    const r = parseLoggCsv(csv, defs, { refYear: 2026 });
    expect(r.warnings.some((w) => /back-gross/i.test(w))).toBe(true);
  });
  it("handles an empty paste without throwing", () => {
    const r = parseLoggCsv("", defs, { refYear: 2026 });
    expect(r.deals).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("reconcileImport — re-import matches Deal # and updates in place", () => {
  let n = 0;
  const makeId = () => `new${++n}`;
  function existing(over: Partial<Deal>): Deal {
    return { id: "x", date: "2026-07-02T12:00:00Z", customer: "C", item: "", amount: 0, secondary: 0, addons: 0, reserve: 0, status: "delivered" as DealStatus, ...over };
  }
  function incoming(over: Partial<Omit<Deal, "id">>): Omit<Deal, "id"> {
    return { date: "2026-07-02T12:00:00Z", customer: "C", item: "", amount: 0, secondary: 0, addons: 0, reserve: 0, status: "delivered" as DealStatus, ...over };
  }

  it("corrects an existing deal's money instead of duplicating (the Jacqueline case)", () => {
    n = 0;
    const before = [existing({ id: "j", dealNumber: "1589", customer: "JACQUELINE", secondary: 5960.55, reserve: 3018.55, phone: "555-1212" })];
    const inc = [incoming({ dealNumber: "1589", customer: "JACQUELINE", secondary: 5551.19, reserve: 2609.19 })];
    const r = reconcileImport(before, inc, makeId);
    expect(r.added).toBe(0);
    expect(r.updated).toBe(1);
    expect(r.deals).toHaveLength(1);
    expect(r.deals[0].id).toBe("j"); // same deal, not a new one
    expect(r.deals[0].secondary).toBe(5551.19); // re-synced
    expect(r.deals[0].reserve).toBe(2609.19);
    expect(r.deals[0].phone).toBe("555-1212"); // app-only field preserved
  });

  it("adds genuinely new deals and updates matches in one pass", () => {
    n = 0;
    const before = [existing({ id: "a", dealNumber: "1001", secondary: 1000 })];
    const inc = [
      incoming({ dealNumber: "1001", secondary: 1500 }), // update
      incoming({ dealNumber: "1002", secondary: 800 }), // new
    ];
    const r = reconcileImport(before, inc, makeId);
    expect(r.added).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.deals).toHaveLength(2);
    expect(r.deals.find((d) => d.dealNumber === "1001")!.secondary).toBe(1500);
    expect(r.deals.find((d) => d.dealNumber === "1002")!.id).toBe("new1");
  });

  it("rows without a Deal # can't be matched, so they always add", () => {
    n = 0;
    const before = [existing({ id: "a", dealNumber: "1001" })];
    const r = reconcileImport(before, [incoming({ customer: "No Number" })], makeId);
    expect(r.added).toBe(1);
    expect(r.updated).toBe(0);
    expect(r.deals).toHaveLength(2);
  });

  it("matches Deal # case/space-insensitively", () => {
    n = 0;
    const before = [existing({ id: "a", dealNumber: " 1001 " })];
    const r = reconcileImport(before, [incoming({ dealNumber: "1001", secondary: 42 })], makeId);
    expect(r.updated).toBe(1);
    expect(r.deals[0].secondary).toBe(42);
  });
});
