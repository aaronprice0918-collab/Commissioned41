// Fills the official Georgia dealer packet (public/forms/georgia-deal-forms.pdf)
// — a real fillable AcroForm — with deal data, so the printed output is the
// genuine state/legal document, not a recreation.
//
// Environment-agnostic: callers pass the PDF bytes (browser fetches it, Node
// reads it) and get back filled PDF bytes.

import { PDFDocument } from "pdf-lib";
import type { CrmLead } from "@/components/CrmProvider";
import { calculateDesk } from "@/lib/desk";

export const GA_PACKET_URL = "/forms/georgia-deal-forms.pdf";

// Default dealer identity (founding store). NOT WIRED TO ANY SCREEN YET —
// when this filler ships, callers MUST pass their own store's name/county
// (a printed state document naming the wrong dealership is a legal defect,
// which is why this is a parameter and not a constant).
const DEALER = {
  name: "Kennesaw Mazda",
  county: "Cobb",
};

const TAVT_RATE = 0.07; // Georgia TAVT (matches the desk tax rate)

function parseVehicle(vehicle: string) {
  const parts = (vehicle || "").trim().split(/\s+/).filter(Boolean);
  let year = "";
  if (parts[0] && /^\d{4}$/.test(parts[0])) year = parts.shift() as string;
  const make = parts.shift() || "";
  const model = parts.join(" ");
  return { year, make, model };
}

function mmddyyyy(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${m}/${d}/${date.getFullYear()}`;
}

function money(value: number) {
  return Number.isFinite(value) ? Math.round(value).toString() : "";
}

type AnyForm = ReturnType<PDFDocument["getForm"]>;

function setText(form: AnyForm, name: string, value: string | number | undefined | null) {
  if (value === undefined || value === null || value === "") return;
  try {
    form.getTextField(name).setText(String(value));
  } catch {
    /* field absent on this packet revision — ignore */
  }
}

// Set the same logical value on every page variant (Field, Field_page2, ...).
function setTextAll(form: AnyForm, baseNames: string[], value: string | number | undefined | null, suffixes: string[]) {
  baseNames.forEach((base) => {
    setText(form, base, value);
    suffixes.forEach((sfx) => setText(form, `${base}${sfx}`, value));
  });
}

function check(form: AnyForm, name: string, on: boolean) {
  if (!on) return;
  try {
    form.getCheckBox(name).check();
  } catch {
    /* ignore */
  }
}

// Spread a string one character per box: VIN1..VIN17, Odom1..Odom6, etc.
function setBoxes(form: AnyForm, prefix: string, value: string, count: number, opts: { rightAlign?: boolean } = {}) {
  const clean = (value || "").toString().toUpperCase().replace(/\s+/g, "");
  if (!clean) return;
  const chars = clean.slice(0, count).split("");
  const offset = opts.rightAlign ? Math.max(count - chars.length, 0) : 0;
  chars.forEach((ch, i) => setText(form, `${prefix}${offset + i + 1}`, ch));
}

const PAGE_SUFFIXES = ["_page2", "_page3", "_page4", "_page5", "_page6", "_page7", "_page8", "_page9", "_page10"];

export async function fillGaPacket(
  pdfBytes: ArrayBuffer | Uint8Array,
  lead: CrmLead,
  dealer: { name: string; county: string } = DEALER,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const form = pdf.getForm();

  const { year, make, model } = parseVehicle(lead.vehicle);
  const vin = (lead.vin || "").toUpperCase();
  const dealDate = mmddyyyy();
  const now = new Date();
  const odometer = lead.vehicleMiles ? String(Math.round(lead.vehicleMiles)) : "";

  // --- Vehicle (every page variant) ---
  setTextAll(form, ["VIN"], vin, PAGE_SUFFIXES);
  setTextAll(form, ["Year", "SaleYear"], year, PAGE_SUFFIXES);
  setTextAll(form, ["Make", "SaleMake"], make, PAGE_SUFFIXES);
  setTextAll(form, ["Model", "SaleModel"], model, PAGE_SUFFIXES);
  setTextAll(form, ["OdometerReading", "Odometer"], odometer, PAGE_SUFFIXES);
  setBoxes(form, "VIN", vin, 17); // p2 char boxes (VIN1..17)
  setBoxes(form, "VIN", vin, 17); // _page4/_page5 share VIN1.. base via their own names below
  ["_page4", "_page5"].forEach((sfx) => {
    const clean = vin.slice(0, 17).split("");
    clean.forEach((ch, i) => setText(form, `VIN${i + 1}${sfx}`, ch));
  });
  setBoxes(form, "Odom", odometer, 6, { rightAlign: true });

  // --- Dates ---
  setTextAll(form, ["DealDate", "DealDate2", "PurchaseDate", "Date"], dealDate, PAGE_SUFFIXES);
  setTextAll(form, ["DealMonth"], String(now.getMonth() + 1), PAGE_SUFFIXES);
  setTextAll(form, ["DealDay"], String(now.getDate()), PAGE_SUFFIXES);
  setTextAll(form, ["DealYear"], String(now.getFullYear()), PAGE_SUFFIXES);

  // --- New / Used ---
  check(form, "New", lead.vehicleClass === "New");
  check(form, "Used", lead.vehicleClass === "Used");
  check(form, "CertOfTitle", lead.vehicleClass === "Used");
  check(form, "MSO", lead.vehicleClass === "New");

  // --- Customer / Owner 1 ---
  const fullName = lead.customer || [lead.customerFirstName, lead.customerMiddleName, lead.customerLastName, lead.customerSuffix].filter(Boolean).join(" ");
  setTextAll(form, ["FullLegalNameCustomer1", "FullLegalNameCustomer", "TransfereeName"], fullName, PAGE_SUFFIXES);
  setText(form, "Customer1First", lead.customerFirstName);
  setText(form, "Customer1Middle", lead.customerMiddleName);
  setText(form, "Customer1Last", lead.customerLastName);
  setText(form, "suffix", lead.customerSuffix);
  setText(form, "Owner1PhysicalAddress", lead.customerAddress);
  setText(form, "Owner1PhysicalCity", lead.customerCity);
  setText(form, "Owner1PhysicalState", lead.customerState);
  setText(form, "Owner1PhysicalZip", lead.customerZip);
  setTextAll(form, ["CustomerAddressLine1", "TransfereeAddressLine1"], lead.customerAddress, PAGE_SUFFIXES);
  setTextAll(form, ["CustomerCity", "TransfereeCity"], lead.customerCity, PAGE_SUFFIXES);
  setTextAll(form, ["CustomerState", "TransfereeState"], lead.customerState, PAGE_SUFFIXES);
  setTextAll(form, ["CustomerZip", "TransfereeZip"], lead.customerZip, PAGE_SUFFIXES);
  setTextAll(form, ["BuyerPhone", "CustomerPhone"], lead.customerPhone, PAGE_SUFFIXES);
  setText(form, "OwnersEmailAddress", lead.customerEmail);

  // --- Dealer (transferor on the odometer/title pages) ---
  setTextAll(form, ["DealerName", "TransferorName", "Name of Registered Owners"], dealer.name, PAGE_SUFFIXES);
  setText(form, "DealerCounty", dealer.county);

  // --- TAVT / tax (page 2) — computed from the desk engine (calculateDesk) so
  // the printed legal MV-7D EQUALS the deal. The desk is the single source of
  // truth: doc fee is IN the taxable base (GA), the trade credit applies ONLY
  // when it qualifies (taxCreditEnabled), and per O.C.G.A. §48-5C-1 a NEW
  // vehicle's rebate DOES reduce the TAVT base (the engine handles it)
  // TAVT. Recomputing inline here previously diverged on all three.
  const desk = calculateDesk(lead);
  const tavtBase = desk.taxableAmount + desk.taxCredit; // pre-credit base = price + doc fee
  setText(form, "TAVTBaseValue", money(tavtBase));
  setText(form, "Rebates", money(0));
  setText(form, "TradeInValue", money(desk.taxCredit));
  setText(form, "TaxableValue", money(desk.taxableAmount));
  setText(form, "TAVTRate", (TAVT_RATE * 100).toFixed(2));
  setText(form, "TAVT", money(desk.tax));

  // --- Trade-in (page 3) ---
  if (lead.tradeYear || lead.tradeMake || lead.tradeModel || lead.tradeValue) {
    setText(form, "Trade1Year", lead.tradeYear);
    setText(form, "Trade1Make", lead.tradeMake);
    setText(form, "Trade1Model", lead.tradeModel);
    setText(form, "TradeValue", money(lead.tradeValue || 0));
    setBoxes(form, "Trade1Odom", lead.tradeMiles ? String(lead.tradeMiles) : "", 6, { rightAlign: true });
    setText(form, "TradeOwner1", fullName);
  }

  // --- Buyer ID / residency ---
  setTextAll(form, ["DriversLicense", "Owner1DL", "Customer1License", "CustomerIDNumber"], lead.driversLicense, PAGE_SUFFIXES);
  setText(form, "Name as Listed on DL", fullName);
  setTextAll(form, ["State/CountryofIssue", "StateOfIssue"], lead.dlState, PAGE_SUFFIXES);
  setText(form, "Owner1DOB", lead.dob);
  setTextAll(form, ["GACountyofResidence", "CustomerCounty"], lead.county, PAGE_SUFFIXES);

  // --- Vehicle detail (MV-1 + odometer pages) ---
  setText(form, "Color", lead.vehicleColor);
  setText(form, "Cylinders", lead.vehicleCylinders);
  setText(form, "Fuel", lead.vehicleFuel);
  setText(form, "BodyStyle", lead.vehicleBody);
  setText(form, "SaleBody", lead.vehicleBody);
  setTextAll(form, ["BodyType"], lead.vehicleBody, PAGE_SUFFIXES);
  setText(form, "CurrentTitle#", lead.currentTitle);

  // --- Co-buyer / Owner 2 ---
  const coName = [lead.coBuyerFirstName, lead.coBuyerMiddleName, lead.coBuyerLastName, lead.coBuyerSuffix].filter(Boolean).join(" ");
  if (coName) {
    setTextAll(form, ["Owner2FullName", "FullLegalNameCustomer2"], coName, PAGE_SUFFIXES);
    setText(form, "Customer2First", lead.coBuyerFirstName);
    setText(form, "Customer2Middle", lead.coBuyerMiddleName);
    setText(form, "Customer2Last", lead.coBuyerLastName);
    setText(form, "suffix2", lead.coBuyerSuffix);
    setText(form, "Owner2DOB", lead.coBuyerDob);
    setTextAll(form, ["Owner2DL", "Customer2License"], lead.coBuyerDl, PAGE_SUFFIXES);
    setText(form, "CobuyerPhone", lead.coBuyerPhone);
    setText(form, "FullPhysicalAddress2", lead.coBuyerAddress);
    setText(form, "Owner2PhysicalCity", lead.coBuyerCity);
    setText(form, "Owner2PhysicalState", lead.coBuyerState);
    setText(form, "Owner2PhysicalZip", lead.coBuyerZip);
  }

  // --- Lienholder ---
  setTextAll(form, ["Lien1Name", "LienName"], lead.lienName, PAGE_SUFFIXES);
  setTextAll(form, ["Lien1Address", "LienAddressLine1"], lead.lienAddress, PAGE_SUFFIXES);

  // --- Agreement to Provide Insurance (page 8) ---
  setText(form, "InsuranceCompanyName", lead.insuranceCompany);
  setText(form, "InsurancePolicyNumber", lead.insurancePolicy);
  setText(form, "InsuranceAgentName", lead.insuranceAgentName);
  setText(form, "InsuranceAgentPhone", lead.insuranceAgentPhone);
  setText(form, "InsuranceAgentAddress", lead.insuranceAgentAddress);
  setText(form, "Effective From", lead.insuranceEffectiveFrom);
  setText(form, "Effective To", lead.insuranceEffectiveTo);
  setText(form, "Comprehensive Deductible", lead.deductibleComprehensive);
  setText(form, "Collision Deductible", lead.deductibleCollision);
  setText(form, "Fire/Theft Deductible", lead.deductibleFireTheft);
  check(form, "CompCoverage", lead.coverageComprehensive);
  check(form, "Collision", lead.coverageCollision);
  check(form, "FireTheft", lead.coverageFireTheft);

  form.updateFieldAppearances();
  return pdf.save();
}
