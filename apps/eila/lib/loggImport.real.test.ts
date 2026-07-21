import { describe, it, expect } from "vitest";
import { parseLoggCsv } from "./loggImport";
import { fniPayPicture } from "./fniPay";
import { kennesawFinancePlan } from "./payplan/plans";
import { DEFAULT_AUTO_PRODUCTS } from "./fni";
import type { Profile } from "./types";

// DRY RUN against Aaron's LIVE "THE LOGG" — the real July 2026 Deal Log, pulled
// straight from the sheet and transcribed column-for-column (headers, ✔/✘ product
// marks, DNQ rows, Adjusted F&I Net, Product Units). This proves the importer
// maps his real sheet AND that the assembled pay picture reproduces THE LOGG's
// own live July dashboard to the dollar:
//   Retail touches 22 · PVR $1,496.00 · PPU 3.18 · pay grid 14.5%+0.5% = 15.0%
//   Gross Commission $4,936.79 · TWS NOT qualified (PVR < $1,550) · spiffs $500.
// It also exercises the gate's OTHER side vs. the qualified months: here TWS pays
// $0 and only the ungated NAS Combo spiff lands.

const HEADER =
  "Deal Date,Deal #,Funding Status,Customer Name,Salesperson 1,Salesperson 2,Sales Manager,F&I Manager,Unit Type,Purchased Vehicle,Bank,Comm. Gross,Doc Fee,Front Gross,Reserve,Back Gross,Deal Gross,VSC,GAP,NAS Combo,Maint,Other,Product Units,Adjusted F&I Net,Month (auto),VIN,Notes";

const ROWS = [
  '7/2/2026,1562,Funded,KAREN DEAN,RICK B,SHAUN H,BRUNNO,Aaron,New,26 MAZDA CX-5,"MAZDA""MOBILITYONE""","-$2,251.00",$899.00,"-$1,352.00",$350.00,"$2,400.00","$1,048.00",✔,✘,✔,✔,✘,7,"$2,400.00",7/1/2026,JM3KMEHAXT0131505,',
  '7/2/2026,1564,Funded,KIMBERLY SULLIVAN,SHAUN H,,BRUNNO,Aaron,New,26 CX-70,MAZDA LEASE,"-$3,225.00",$899.00,"-$2,326.00",$634.03,$634.03,"-$1,691.97",✘,✘,✘,✘,✘,0,$634.03,7/1/2026,JM3KJDHD3T1207878,',
  '7/2/2026,1565,Funded,VERONICA PORTILLO YUREVICH,EL,TONY,BRUNNO,Aaron,New,26 CX-5,"MAZDA""MOBILITYONE""",$137.00,$899.00,"$1,036.00",$250.00,"$3,050.00","$4,086.00",✔,✘,✔,✔,✘,7,"$3,050.00",7/1/2026,JM3KMEHA2T0132227,',
  '7/2/2026,1566,Funded,JACOB SPELL,GREG,,BRUNNO,Aaron,New,26 CX-50,"MAZDA""MOBILITYONE""",$232.50,$899.00,"$1,131.50",$300.00,$900.00,"$2,031.50",✔,✘,✘,✘,✘,1,$900.00,7/1/2026,7MMVABBLXTN605236,',
  '7/3/2026,1567,Funded,RODNEY STEGALL,TONY,,BRUNNO,Aaron,New,26 CX-5,"MAZDA""MOBILITYONE""","-$1,750.00",$899.00,-$851.00,$250.00,"$1,525.00",$674.00,✔,✘,✔,✘,✘,6,"$1,525.00",7/1/2026,JM3KMEHA6T0155803,',
  '7/3/2026,1568,Funded,NICOLE MASON,JOSHUA,,BRUNNO,HOUSE,Do Not Qualify,25 CX-5,***CASH***,"-$2,123.45",$899.00,"-$1,224.45",$250.00,$250.00,-$974.45,✘,✘,✘,✘,✘,0,$0.00,7/1/2026,JM3KFBCM6S0638717,',
  '7/3/2026,1569,Funded,VIVIAN JONES,SHAUN H,,MATT,Aaron,New,26 CX-30,"MAZDA""MOBILITYONE""","-$1,135.00",$899.00,-$236.00,$250.00,$250.00,$14.00,✘,✘,✘,✘,✘,0,$250.00,7/1/2026,3MVDMBXL1TM200449,',
  '7/3/2026,1571,Funded,ALLISON WILLS,TONY,GREG,BRUNNO,Aaron,Used,26 CX-90,LGE COMMUNITY CREDIT UNION,"$2,032.19",$899.00,"$2,931.19",$75.96,$75.96,"$3,007.15",✘,✘,✘,✘,✘,0,$75.96,7/1/2026,JM3KKAHD9T1350412,',
  '7/3/2026,1570,Funded,PAUL MILLER,RICK B,,DARYL,HOUSE,Do Not Qualify,14 MAXIMA,***CASH***,"-$1,881.00",$899.00,-$982.00,$0.00,$0.00,-$982.00,✘,✘,✘,✘,✘,0,$0.00,7/1/2026,1N4AA5AP5EC446800,',
  '7/6/2026,1576,Funded,KENNETH WEST,RICK B,,BRUNNO,Aaron,Used,26 TACOMA,***CASH***,"$3,250.55",$899.00,"$4,149.55",$0.00,$0.00,"$4,149.55",✘,✘,✘,✘,✘,0,$0.00,7/1/2026,3TYKB5FN8TT033191,',
  '7/8/2026,1585,Funded,MAJOR WARNER,JOSHUA,,BRUNNO,Aaron,New,26 MIATA,***CASH***,-$435.00,$899.00,$464.00,$0.00,$0.00,$464.00,✘,✘,✘,✘,✘,0,$0.00,7/1/2026,JM1NDAD76T0701847,',
  '7/8/2026,1586,Not Funded,NICHOLAS JERNIGAN,JOSHUA,,PAUL,Aaron,Used,25 MIATA,REGIONAL ACCEPTANCE,$939.79,$899.00,"$1,838.79",$700.00,"$2,627.00","$4,465.79",✔,✔,✔,✘,✘,7,"$2,627.00",7/1/2026,JM1NDAC7XS0654998,',
  '7/9/2026,1589,Not Funded,JACQUELINE LOWE-BROWN,JOE,,MATT,Aaron,New,26 CX-90,TD AUTO,"-$3,208.00",$899.00,"-$2,309.00","$2,609.19","$5,551.19","$3,242.19",✔,✘,✔,✔,✘,7,"$5,551.19",7/1/2026,JM3KKCHA5T1377270,',
  '7/9/2026,1593,Funded,EMA ALVEREZ,SHAUN H,MAGED,MATT,Aaron,New,26 MAZDA3,MAZDA LEASE,"-$1,245.24",$899.00,-$346.24,$200.00,"$1,115.00",$768.76,✘,✘,✔,✘,✘,5,"$1,115.00",7/1/2026,JM1BPAKL1T1884711,',
  '7/9/2026,1592,Funded,DORA HUGHES,JOE,,MATT,Aaron,New,26 CX-70,***CASH***,"-$3,008.00",$899.00,"-$2,109.00",$0.00,$0.00,"-$2,109.00",✘,✘,✘,✘,✘,0,$0.00,7/1/2026,JM3KJEHD2T1207991,',
  '7/10/2026,1594,Not Funded,EMILY ADAMS,GREG,,MATT,Aaron,New,26 CX-70,***CASH***,,$899.00,$899.00,$0.00,$500.00,"$1,399.00",✘,✘,✘,✔,✘,1,$500.00,7/1/2026,JM3KJBHDXT1210300,',
  '7/11/2026,1591,Funded,MARIO CRISTOFANO,RICK B,,PAUL,Aaron,Used,24 CX-5,***CASH***,"-$3,788.33",$899.00,"-$2,889.33",$0.00,$0.00,"-$2,889.33",✘,✘,✘,✘,✘,0,$0.00,,JM3KFBCL5R0492747,',
  '7/11/2026,1605,Not Funded,LATRESE FINTAK,SHAWN S,,MATT,Aaron,New,26 CX-5,"MAZDA""MOBILITYONE""",-$331.00,$899.00,$568.00,$450.00,"$2,417.00","$2,985.00",✔,✔,✔,✘,✘,7,"$2,417.00",,JM3KMDHA8T0159376,',
  '7/11/2026,1606,Not Funded,AUSTIN EMERSON,DANIEL,,BRUNNO,Aaron,New,26 CX-50,"MAZDA""MOBILITYONE""",-$816.96,$899.00,$82.04,$300.00,"$2,000.00","$2,082.04",✔,✘,✔,✔,✘,7,"$2,000.00",,7MMVAABW7TN182197,',
  '7/11/2026,1608,Funded,GORDON MACHIELSEN,GREG,,MATT,Aaron,Used,21 CX-9,***CASH***,"$2,243.29",$899.00,"$3,142.29",$0.00,$0.00,"$3,142.29",✘,✘,✘,✘,✘,0,$0.00,,JM3TCBEY5M0533845,',
  '7/11/2026,1610,Funded,MATTHEW PRIEL,TONY,,MATT,Aaron,New,26 CX-50,***CASH***,"-$1,835.00",$899.00,-$936.00,$0.00,$0.00,-$936.00,✘,✘,✘,✘,✘,0,$0.00,,7MMVABCY0TN609516,',
  '7/11/2026,1612,Funded,SANDRA CHICOINE-BLACK,DANIEL,,MATT,Aaron,New,26 CX-5,WELLS FARGO,"-$1,559.00",$899.00,-$660.00,"$1,562.65","$4,662.65","$4,002.65",✔,✘,✔,✔,✘,7,"$4,662.65",,JM3KMCHA2T0127338,',
  '7/13/2026,1613,Funded,ROY SOLIS ,HOUSE,,PAUL,HOUSE,Do Not Qualify,26 MAZDA 3,***CASH***,$506.77,$899.00,"$1,405.77",$0.00,$0.00,"$1,405.77",✘,✘,✘,✘,✘,0,$0.00,,JM1BPACL2T1886546,',
  '7/15/2026,1629,Not Funded,SERENA TURNER,JOSHUA,,BRUNNO,Aaron,New,26 CX-30,"MAZDA""MOBILITYONE""",$508.00,$899.00,"$1,407.00","$1,178.10","$3,004.10","$4,411.10",✔,✔,✘,✘,✘,2,"$3,004.10",,3MVDMBBL3TM149804,',
  '7/15/2026,1631,Not Funded,HALLIE POPPE ,MAGED,,BRUNNO,Aaron,New,26 CX-5,"MAZDA""MOBILITYONE""",$615.65,$899.00,"$1,514.65",$400.00,"$2,200.00","$3,714.65",✔,✘,✔,✘,✘,6,"$2,200.00",,JM3KMDHA4T0171427,',
];

const CSV = [HEADER, ...ROWS].join("\n");

function financeProfile(): Profile {
  return {
    name: "Aaron",
    role: "finance",
    industry: "automotive",
    plan: kennesawFinancePlan(),
    products: DEFAULT_AUTO_PRODUCTS,
    createdAt: "2026-07-01T00:00:00Z",
  };
}

describe("DRY RUN — real THE LOGG July Deal Log imports cleanly", () => {
  const r = parseLoggCsv(CSV, DEFAULT_AUTO_PRODUCTS, { refYear: 2026 });

  it("imports all 25 deals, every column mapped, no warnings", () => {
    expect(r.deals.length).toBe(25);
    expect(r.skipped).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  it("flags the 3 Do-Not-Qualify rows (Nicole, Paul, Roy) as no-qualify, $0 credit", () => {
    const dnq = r.deals.filter((d) => d.noQualify);
    expect(dnq.map((d) => d.customer).sort()).toEqual(["NICOLE MASON", "PAUL MILLER", "ROY SOLIS"]);
    expect(dnq.every((d) => d.secondary === 0)).toBe(true);
  });

  it("lands the first deal (Karen Dean) with the right money, products, and split", () => {
    const karen = r.deals[0];
    expect(karen.customer).toBe("KAREN DEAN");
    expect(karen.secondary).toBe(2400); // Adjusted F&I Net
    expect(karen.products).toEqual(["vsc", "combo", "maint"]); // ✔ VSC, NAS Combo, Maint
    expect(karen.addons).toBe(7); // Product Units
    expect(karen.category).toBe("new");
    expect(karen.salesperson).toBe("RICK B");
    expect(karen.salesperson2).toBe("SHAUN H");
  });
});

describe("DRY RUN — pay picture reproduces THE LOGG's LIVE July dashboard to the dollar", () => {
  const deals = parseLoggCsv(CSV, DEFAULT_AUTO_PRODUCTS, { refYear: 2026 }).deals.map((d, i) => ({ ...d, id: `j${i}` }));
  const pic = fniPayPicture(financeProfile(), deals)!;

  it("counts 22 retail touches (3 DNQ excluded), PVR $1,496.00, PPU 3.18", () => {
    expect(pic.units).toBe(22);
    expect(pic.pvr).toBeCloseTo(1496.0, 1);
    expect(pic.ppu).toBeCloseTo(3.18, 1);
  });

  it("pay grid 14.5% base + 0.5% VSC bonus = 15.0%; Gross Commission $4,936.79", () => {
    expect(pic.pay.rateBreakdown!.base).toBe(14.5);
    expect(pic.pay.rateBreakdown!.bonusRate).toBe(0.5);
    expect(pic.pay.grossCommission).toBeCloseTo(4936.79, 2);
  });

  it("TWS is NOT qualified (PVR $1,496 < $1,550): TWS $0, only NAS Combo $500", () => {
    expect(pic.spiffs.gatedQualified).toBe(false);
    expect(pic.spiffs.lines.find((l) => l.id === "vsc")!.amount).toBe(0);
    expect(pic.spiffs.lines.find((l) => l.id === "nas")!.amount).toBe(500); // 10 NAS Combos × $50
    expect(pic.spiffs.total).toBe(500);
  });
});
