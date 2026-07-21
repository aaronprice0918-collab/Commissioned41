// "Your Deal" — the customer-facing deal page (the store's first
// consumer-facing surface). A rep shares an unguessable link from the lead
// card; the customer sees THEIR deal: the vehicle, the payment, what to bring,
// and where things stand. No login, no app, works in any phone browser.
//
// SECURITY MODEL: the token is `<orgId>.<32-hex random>` — the orgId prefix
// routes the lookup (a public URL has no other org context), the random half
// is the secret. The public payload is a hand-picked allowlist of fields the
// customer already knows about their own deal (their first name, their car,
// their payment) — never gross, never cost, never other customers. The token
// lives on the lead (JSONB) and is revocable: clear/regenerate it and every
// previously shared link dies.

import type { CrmLead } from "@/components/CrmProvider";

export type YourDealPayload = {
  storeName: string;
  customerFirstName: string;
  vehicle: string;
  stockNumber: string;
  vehicleClass: string;
  status: string; // customer-friendly stage line
  payment: number | null; // monthly estimate, null when the desk has no numbers
  term: number | null;
  cashDown: number | null;
  salesperson: string;
  salespersonPhone?: string;
  appointment?: string;
  docsToBring: string[];
  nextSteps: string[];
};

// What stage means to the CUSTOMER (never internal desk-speak).
export function customerStatusLine(status: CrmLead["status"]): string {
  switch (status) {
    case "New Lead":
    case "Working":
      return "We're getting everything ready for you";
    case "Appointment Set":
      return "Your visit is on the books";
    case "Shown":
      return "Great meeting you — we're putting your numbers together";
    case "Desking":
      return "Your numbers are being finalized";
    case "In Finance":
      return "You're in the finance office — almost home";
    case "Won":
      return "Congratulations — your vehicle is yours!";
    default:
      return "We're here when you're ready";
  }
}

// What the customer should bring, driven by where the deal actually is.
export function docsToBring(lead: Pick<CrmLead, "status" | "driversLicense" | "insuranceCompany" | "tradeDetails" | "tradeYear" | "payoff">): string[] {
  const docs: string[] = [];
  docs.push(lead.driversLicense ? "Driver's license (we have a copy — bring it anyway)" : "Driver's license");
  docs.push(lead.insuranceCompany ? "Proof of insurance (we have your carrier on file)" : "Proof of insurance");
  if (lead.tradeDetails || lead.tradeYear) {
    docs.push("Your trade's title or payoff statement");
    docs.push("Both sets of keys for your trade");
  }
  if (lead.payoff > 0) docs.push("Your current loan account number");
  if (lead.status === "In Finance" || lead.status === "Desking") docs.push("Proof of income (recent pay stub) — speeds up financing");
  return docs;
}

export function nextSteps(lead: Pick<CrmLead, "status" | "appointment">): string[] {
  switch (lead.status) {
    case "Won":
      return ["Enjoy the new ride!", "Your paperwork copies will be ready at pickup", "Watch for a review link — it means the world to us"];
    case "In Finance":
      return ["Finalize your protection options with the finance manager", "Sign and drive"];
    case "Desking":
      return ["Review your numbers with the desk", "Head to finance", "Sign and drive"];
    case "Appointment Set":
      return [lead.appointment ? "Come see us at your scheduled time" : "Come see us", "Take the test drive", "We'll have your numbers ready"];
    default:
      return ["Reply to your salesperson to set a time", "Take the test drive", "We'll have your numbers ready"];
  }
}

const TOKEN_RE = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/i;

export function parseShareToken(token: string): { orgId: string; secret: string } | null {
  const m = TOKEN_RE.exec(String(token || "").trim());
  return m ? { orgId: m[1], secret: m[2] } : null;
}

export function makeShareToken(orgId: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${orgId}.${secret}`;
}
