import test from "node:test";
import assert from "node:assert/strict";
import { isProductOnly, isRetail, isVehicleUnit, type Deal } from "./data.ts";
import { buildPerformance } from "./buildPerformance.ts";

function deal(o: Partial<Deal>): Deal {
  const base = {
    id: "d", vehicleClass: "New", salesperson: "", stockNumber: "", vin: "",
    frontGross: 0, backGrossReserve: 0, date: "2026-07-10", stage: "Delivered",
    financeStatus: "Classified", products: {},
  };
  return { ...base, ...(o as object) } as unknown as Deal;
}

test("product-only deal (VSC+appearance, no vehicle) is flagged; retail but not a unit", () => {
  const d = deal({ stockNumber: "", vin: "", frontGross: 0, backGrossReserve: 1100, products: { vsc: true } });
  assert.equal(isProductOnly(d), true);
  assert.equal(isRetail(d), true); // its gross + products still count
  assert.equal(isVehicleUnit(d), false); // but it is NOT a car unit
});

test("a real New sale is a vehicle unit (has a stock number)", () => {
  const d = deal({ stockNumber: "1887192", frontGross: 0, backGrossReserve: 1400 });
  assert.equal(isProductOnly(d), false);
  assert.equal(isVehicleUnit(d), true);
});

test("a New sale with only an invoice (no stock yet) is NOT product-only", () => {
  const d = deal({ stockNumber: "", vin: "", frontGross: 0, invoiceAmount: 28000, backGrossReserve: 1200 });
  assert.equal(isProductOnly(d), false);
});

test("a deal with front gross is NOT product-only even with no stock/vin", () => {
  const d = deal({ stockNumber: "", vin: "", frontGross: 500, backGrossReserve: 800 });
  assert.equal(isProductOnly(d), false);
});

test("product-only: back gross feeds PVR, products feed PPU, but no unit is added", () => {
  const deals = [
    deal({ vehicleClass: "New", stockNumber: "A1", frontGross: 2000, backGrossReserve: 1000, products: { vsc: true } }), // real car
    deal({ vehicleClass: "New", stockNumber: "", vin: "", frontGross: 0, backGrossReserve: 1100, products: { vsc: true, gap: true } }), // product-only
  ];
  const perf = buildPerformance(deals);
  assert.equal(perf.units, 1); // product-only is not a vehicle unit
  assert.equal(perf.frontGross, 2000); // product-only front is 0
  assert.equal(perf.backGross, 2100); // 1000 + 1100 product-only back COUNTS
  assert.equal(perf.pvr, 2100); // back PVR = 2100 / 1 car — product income boosts PVR
  assert.equal(perf.frontPvr, 2000); // 2000 / 1, not diluted by a phantom unit
  assert.equal(perf.products, 3); // 1 (car: vsc) + 2 (product-only: vsc+gap) all count toward PPU
  assert.equal(perf.ppu, 3); // 3 products / 1 car unit
});
