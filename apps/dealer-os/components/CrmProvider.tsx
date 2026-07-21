"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";
import { useRefreshOnWake } from "@/lib/useRefreshOnWake";

export type LeadStatus = "New Lead" | "Working" | "Appointment Set" | "Shown" | "Desking" | "In Finance" | "Won" | "Lost";

// Road to the sale — the sales manager checks these off as the deal progresses,
// in order, so the floor (and EILA) can see exactly where every up stands.
export type DealStep = "needsAnalysis" | "demo" | "testDrive" | "earlyTO" | "numbers" | "pullCredit" | "finalTO" | "pushToFinance";
export type DealProgress = Partial<Record<DealStep, boolean>>;
export const DEAL_STEPS: { key: DealStep; label: string }[] = [
  { key: "needsAnalysis", label: "Needs Analysis" },
  { key: "demo", label: "Demo / Walkaround" },
  { key: "testDrive", label: "Test Drive" },
  { key: "earlyTO", label: "Early TO" },
  { key: "numbers", label: "Numbers" },
  { key: "pullCredit", label: "Pull Credit" },
  { key: "finalTO", label: "Final TO" },
  { key: "pushToFinance", label: "Push to Finance" },
];

export type CrmLead = {
  id: string;
  // When the lead was created (ISO). Optional — older leads predate it and fall
  // back to the timestamp in their CRM-<ms> id for "today" scoping on the board.
  date?: string;
  customer: string;
  customerFirstName: string;
  customerMiddleName: string;
  customerLastName: string;
  customerSuffix: string;
  customerAddress: string;
  customerCity: string;
  customerState: string;
  customerZip: string;
  customerPhone: string;
  customerEmail: string;
  creditScore: string;
  employer: string;
  monthlyIncome: string;
  residenceStatus: string;
  source: string;
  vehicleClass: "New" | "Used" | "Lease";
  vehicle: string;
  vin: string;
  stockNumber: string;
  vehicleMiles: number;
  salesperson: string;
  deskManager?: string;
  financeManager: string;
  status: LeadStatus;
  // Manual physical-presence gate (Aaron's rule): a lead only shows on the
  // Showroom floor when someone presses "Customer in Showroom" — i.e. they're
  // physically in the building. Absent/false = not on the floor. A delivered
  // deal that was never marked inShowroom is a remote / never-came-in sale.
  inShowroom?: boolean;
  creditStatus: "Not Started" | "Sent" | "Received" | "Submitted" | "Approved" | "Declined";
  appointment: string;
  // Lightweight confirm flag for the Appointment Board (lives in the lead's JSONB
  // blob — not a schema change). Absent/false = appointment not yet confirmed.
  appointmentConfirmed?: boolean;
  // Why a lead was marked Lost — captured at the moment of loss so no deal dies
  // without a reason a manager can act on. JSONB key, not a schema change.
  lostReason?: string;
  // "Your Deal" share token (lib/yourDeal.ts): `<orgId>.<32-hex secret>` — the
  // unguessable key behind the customer's public deal page. Absent = never
  // shared. Clearing it revokes every link ever sent.
  shareToken?: string;
  // The Five-Minute Response stamp (lib/speedToLead.ts): when this lead was
  // FIRST contacted — set once by tapping the phone/email link or moving the
  // lead past New Lead, never overwritten. Absent on a New Lead = the 5:00
  // clock is running.
  firstContactAt?: string;
  // The text thread (lib/comms.ts): every SMS in/out with this customer, in
  // order. Written ONLY by the server (/api/sms/send + /api/sms/webhook) so
  // the thread is the store's record; clients just render it. JSONB key.
  messages?: import("@/lib/comms").LeadMessage[];
  // TCPA consent rail (lib/consent.ts): append-only per-channel consent audit
  // trail — who said yes/no to call/text/email, when, how, recorded by whom.
  // Absent = nothing recorded (unknown). A revoked channel must not be
  // contacted; every outbound surface checks this before showing a live link.
  consent?: { events: import("@/lib/consent").ConsentEvent[] };
  // Append-only log of status changes (status + ISO timestamp). Powers honest
  // time-in-stage / stuck-deal detection and, later, the customer journey
  // timeline. JSONB key — accrues going forward; older leads simply lack it.
  statusHistory?: { status: LeadStatus; at: string }[];
  nextAction: string;
  notes: string;
  managerNotes?: string;
  progress?: DealProgress;
  tradeDetails: string;
  tradeYear: string;
  tradeMake: string;
  tradeModel: string;
  tradeMiles: number;
  tradePayoffSource: string;
  tradeAcv: number;
  tradeNotes: string;
  weOwe: string;
  sellingPrice: number;
  unitCost: number;
  docFee: number;
  rebate: number;
  tradeValue: number;
  // Manual: the F&I manager checks whether the customer qualifies for the GA
  // TAVT trade credit. Off when they don't own the trade outright — a leased
  // trade, or a trade titled in someone else's name not on the new loan.
  taxCreditEnabled: boolean;
  payoff: number;
  cashDown: number;
  buyRate: number;
  sellRate: number;
  rate: number;
  term: number;
  showProductsOnWorksheet: boolean;
  showPaymentSpread: boolean;
  paymentSpreadStep: 10 | 20;
  // Buyer ID / residency (required on MV-1 and POA)
  driversLicense: string;
  dlState: string;
  dob: string;
  county: string;
  // Co-buyer (optional second owner)
  coBuyerFirstName: string;
  coBuyerMiddleName: string;
  coBuyerLastName: string;
  coBuyerSuffix: string;
  coBuyerPhone: string;
  coBuyerEmail: string;
  coBuyerAddress: string;
  coBuyerCity: string;
  coBuyerState: string;
  coBuyerZip: string;
  coBuyerDl: string;
  coBuyerDlState: string;
  coBuyerDob: string;
  coBuyerCounty: string;
  // Vehicle detail (MV-1)
  vehicleColor: string;
  vehicleBody: string;
  vehicleCylinders: string;
  vehicleFuel: string;
  currentTitle: string;
  // Lienholder
  lienName: string;
  lienAddress: string;
  // Agreement to Provide Insurance
  insuranceCompany: string;
  insurancePolicy: string;
  insuranceAgentName: string;
  insuranceAgentPhone: string;
  insuranceAgentAddress: string;
  insuranceEffectiveFrom: string;
  insuranceEffectiveTo: string;
  // On-file customer documents — storage paths (NOT the image bytes) for the
  // photographed driver's license and insurance card. Served back through a
  // short-lived signed URL; kept out of the JSONB blob so leads stay small.
  driverLicenseDocPath?: string;
  insuranceCardDocPath?: string;
  coverageCollision: boolean;
  coverageComprehensive: boolean;
  coverageFireTheft: boolean;
  deductibleCollision: string;
  deductibleComprehensive: string;
  deductibleFireTheft: string;
  products: {
    vsc: number;
    gap: number;
    maintenance: number;
    permaplate: number;
    tws: number;
    utp: number;
  };
};

// A complete blank retail lead — the starting point for the "New retail deal"
// quick-desk (Desking page) so a manager can structure numbers without first
// building a customer in CRM. Every required CrmLead field is set here, so the
// type checker guarantees this stays in sync with the shape above. status starts
// "Desking" so it lands on the desk; customer is blank for the manager to fill.
export function makeScratchLead(overrides: Partial<CrmLead> = {}): CrmLead {
  return {
    id: `CRM-${Date.now()}`,
    date: new Date().toISOString(),
    customer: "",
    customerFirstName: "", customerMiddleName: "", customerLastName: "", customerSuffix: "",
    customerAddress: "", customerCity: "", customerState: "", customerZip: "",
    customerPhone: "", customerEmail: "",
    creditScore: "", employer: "", monthlyIncome: "", residenceStatus: "",
    source: "Walk-in",
    vehicleClass: "New", vehicle: "", vin: "", stockNumber: "", vehicleMiles: 0,
    salesperson: "", financeManager: "",
    status: "Desking",
    creditStatus: "Not Started",
    appointment: "", nextAction: "", notes: "",
    tradeDetails: "", tradeYear: "", tradeMake: "", tradeModel: "", tradeMiles: 0,
    tradePayoffSource: "", tradeAcv: 0, tradeNotes: "", weOwe: "",
    sellingPrice: 0, unitCost: 0, docFee: 0, rebate: 0, tradeValue: 0,
    taxCreditEnabled: true,
    payoff: 0, cashDown: 0, buyRate: 0, sellRate: 0, rate: 0, term: 0,
    showProductsOnWorksheet: false, showPaymentSpread: false, paymentSpreadStep: 10,
    driversLicense: "", dlState: "", dob: "", county: "",
    coBuyerFirstName: "", coBuyerMiddleName: "", coBuyerLastName: "", coBuyerSuffix: "",
    coBuyerPhone: "", coBuyerEmail: "", coBuyerAddress: "", coBuyerCity: "",
    coBuyerState: "", coBuyerZip: "", coBuyerDl: "", coBuyerDlState: "",
    coBuyerDob: "", coBuyerCounty: "",
    vehicleColor: "", vehicleBody: "", vehicleCylinders: "", vehicleFuel: "", currentTitle: "",
    lienName: "", lienAddress: "",
    insuranceCompany: "", insurancePolicy: "", insuranceAgentName: "",
    insuranceAgentPhone: "", insuranceAgentAddress: "",
    insuranceEffectiveFrom: "", insuranceEffectiveTo: "",
    coverageCollision: false, coverageComprehensive: false, coverageFireTheft: false,
    deductibleCollision: "", deductibleComprehensive: "", deductibleFireTheft: "",
    products: { vsc: 0, gap: 0, maintenance: 0, permaplate: 0, tws: 0, utp: 0 },
    ...overrides,
  };
}

type CrmContextValue = {
  leads: CrmLead[];
  // False until the first server read lands — screens must show a loading
  // state, never present an empty board as the real one.
  loaded: boolean;
  addLead: (lead: CrmLead) => void;
  updateLead: (leadId: string, updates: Partial<CrmLead>) => void;
  deleteLead: (leadId: string) => void;
  // True after a save lost a compare-and-swap race: another device wrote
  // first, we adopted its copy, and the user's last change may need re-entry.
  conflicted: boolean;
  clearConflict: () => void;
};

const CrmContext = createContext<CrmContextValue | null>(null);

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const readyToSave = useRef(false);
  const fromServer = useRef(false);
  const lastLocalEdit = useRef(0);

  useEffect(() => {
    loadStore<CrmLead[]>("crmLeads").then((saved) => {
      if (Array.isArray(saved)) setLeads(saved);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!readyToSave.current) {
      readyToSave.current = true;
      return;
    }
    if (fromServer.current) {
      fromServer.current = false;
      return;
    }
    // Compare-and-swap save: consent trails and text threads ride this array —
    // legal records a stale tab must never clobber. Losing the race means
    // another device wrote first: adopt its copy (server truth) and flag it so
    // the screen can tell the user their last change may need re-entry.
    void saveStoreGuarded<CrmLead[]>("crmLeads", leads).then((result) => {
      if (result.ok || result.conflict !== true) return;
      if (Array.isArray(result.value)) {
        fromServer.current = true;
        setLeads(result.value);
      }
      setConflicted(true);
    });
  }, [leads, loaded]);

  // Heartbeat: keep the board live by pulling the latest every 12s, so a
  // change made on the floor (or another device) shows up on its own. Skips
  // if the user just made a local edit, to avoid clobbering their change.
  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => {
      if (Date.now() - lastLocalEdit.current < 6000) return;
      void loadStore<CrmLead[]>("crmLeads").then((saved) => {
        if (!Array.isArray(saved)) return;
        setLeads((current) => {
          if (JSON.stringify(saved) === JSON.stringify(current)) return current;
          fromServer.current = true;
          return saved;
        });
      });
    }, 12000);
    return () => clearInterval(id);
  }, [loaded]);

  // Fresh on open: the heartbeat freezes while the phone sleeps — pull the
  // board the instant the app wakes instead of waiting out the next tick.
  useRefreshOnWake(() => {
    if (!loaded) return;
    if (Date.now() - lastLocalEdit.current < 6000) return;
    void loadStore<CrmLead[]>("crmLeads").then((saved) => {
      if (!Array.isArray(saved)) return;
      setLeads((current) => {
        if (JSON.stringify(saved) === JSON.stringify(current)) return current;
        fromServer.current = true;
        return saved;
      });
    });
  });

  const value = useMemo(
    () => ({
      leads,
      addLead: (lead: CrmLead) => {
        lastLocalEdit.current = Date.now();
        setLeads((current) => [lead, ...current]);
      },
      updateLead: (leadId: string, updates: Partial<CrmLead>) => {
        lastLocalEdit.current = Date.now();
        setLeads((current) => current.map((lead) => (lead.id === leadId ? { ...lead, ...updates } : lead)));
      },
      deleteLead: (leadId: string) => {
        lastLocalEdit.current = Date.now();
        setLeads((current) => current.filter((lead) => lead.id !== leadId));
      },
      loaded,
      conflicted,
      clearConflict: () => setConflicted(false),
    }),
    [leads, loaded, conflicted]
  );

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrmLeads() {
  const context = useContext(CrmContext);
  if (!context) {
    throw new Error("useCrmLeads must be used inside CrmProvider");
  }
  return context;
}
