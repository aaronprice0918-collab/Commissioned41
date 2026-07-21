"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { canonicalPersonName, team } from "@/lib/data";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";
import { useRefreshOnWake } from "@/lib/useRefreshOnWake";

export type PayRole = "Sales" | "Manager" | "F&I";

// Structured salesperson commission plan. The flat PayPlan fields below can't
// express a real sales plan (per-class tiers, a volume ladder, conditional
// bonuses), so Sales pay reads this instead. Defaults reproduce Kennesaw's exact
// plan; an admin edits it per store / per rep. Every field is store-configurable.
export type SalesVolumeTier = { units: number; bonus: number };

export type SalesPlan = {
  // New-vehicle flat commission by commissionable front gross (CGP) band.
  newHighFlat: number;   // CGP >= newHighMin
  newHighMin: number;
  newMidFlat: number;    // CGP >= newMidMin
  newMidMin: number;
  newMiniFlat: number;   // below newMidMin
  // Used-vehicle: percent of CGP, with a higher rate above a threshold + a floor.
  usedPct: number;
  usedHighPct: number;
  usedHighMin: number;
  usedMinCommission: number;
  // Any other retail vehicle class falls back to a flat mini.
  miniCommission: number;
  // Monthly volume bonus ladder (units -> bonus), evaluated highest tier first.
  volumeTiers: SalesVolumeTier[];
  // Finance PVR bonus: month units >= units AND back PVR >= backPvr.
  financeBonusUnits: number;
  financeBonusBackPvr: number;
  financeBonusAmount: number;
  // Fast-start bonus: units delivered on/before byDay of the month >= units.
  fastStartUnits: number;
  fastStartByDay: number;
  fastStartAmount: number;
  // Bonus eligibility gate (Certified / Group CSI / 90% connected service + CRM).
  // Defaults ON — the rep is assumed to hit it. A manager flips it OFF the rare
  // month a requirement is missed, which forfeits the monthly bonuses. Undefined
  // is treated as eligible so existing plans keep paying.
  bonusEligible?: boolean;
};

// Kennesaw Mazda's live plan — the exact numbers that were previously hardcoded.
// This is the default for every new Sales plan, so nothing changes for Kennesaw.
export const defaultSalesPlan: SalesPlan = {
  newHighFlat: 400, newHighMin: 1,
  newMidFlat: 250, newMidMin: -300,
  newMiniFlat: 150,
  usedPct: 25, usedHighPct: 30, usedHighMin: 3000, usedMinCommission: 150,
  miniCommission: 150,
  volumeTiers: [
    { units: 24, bonus: 1900 },
    { units: 21, bonus: 1600 },
    { units: 18, bonus: 1300 },
    { units: 15, bonus: 1000 },
    { units: 12, bonus: 500 },
  ],
  financeBonusUnits: 10, financeBonusBackPvr: 1300, financeBonusAmount: 500,
  fastStartUnits: 7, fastStartByDay: 15, fastStartAmount: 500,
};

export type PayPlan = {
  personName: string;
  role: PayRole;
  monthlyBase: number;
  flatPerUnit: number;
  frontGrossPct: number;
  backGrossPct: number;
  totalGrossPct: number;
  productUnitBonus: number;
  unitBonusThreshold: number;
  unitBonusAmount: number;
  // Present on Sales plans; drives Sales commission. Falls back to defaultSalesPlan.
  sales?: SalesPlan;
  // F&I penalty state — default MET (no penalty). A manager flips one off the
  // rare month the F&I manager misses it: menu under 95% → −5% of gross; CSI
  // below region → −5% (+3% per additional consecutive month below).
  menuMet?: boolean;
  csiMet?: boolean;
  csiMonthsBelow?: number;
};

type PayPlanContextValue = {
  currentPerson: string;
  setCurrentPerson: (person: string) => void;
  payPlans: PayPlan[];
  savePayPlan: (plan: PayPlan) => void;
  savePayPlans: (plans: PayPlan[]) => void;
  resetPayPlans: () => void;
};

const storageKey = "commissioned41.payplans.v1";
const currentUserKey = "commissioned41.currentUser.v1";

export const defaultPayPlans: PayPlan[] = [
  ...team
    .filter((member) => member.role === "Sales")
    .map((member) => ({
      personName: member.name,
      role: "Sales" as PayRole,
      monthlyBase: 0,
      flatPerUnit: 200,
      frontGrossPct: 25,
      backGrossPct: 0,
      totalGrossPct: 0,
      productUnitBonus: 25,
      unitBonusThreshold: 12,
      unitBonusAmount: 750,
      sales: defaultSalesPlan,
    })),
  ...team
    .filter((member) => member.role === "Manager")
    .map((member) => ({
      personName: member.name,
      role: "Manager" as PayRole,
      monthlyBase: 2500,
      flatPerUnit: 25,
      frontGrossPct: 2,
      backGrossPct: 0,
      totalGrossPct: 0,
      productUnitBonus: 0,
      unitBonusThreshold: 130,
      unitBonusAmount: 2000,
    })),
  ...team
    .filter((member) => member.role === "F&I")
    .map((member) => ({
      personName: member.name,
      role: "F&I" as PayRole,
      monthlyBase: 0,
      flatPerUnit: 0,
      frontGrossPct: 0,
      backGrossPct: 12,
      totalGrossPct: 0,
      productUnitBonus: 40,
      unitBonusThreshold: 45,
      unitBonusAmount: 1000,
    })),
];

const PayPlanContext = createContext<PayPlanContextValue | null>(null);

export function PayPlanProvider({ children }: { children: React.ReactNode }) {
  const [currentPerson, setCurrentPersonState] = useState("");
  const [payPlans, setPayPlans] = useState<PayPlan[]>(defaultPayPlans);
  const [loaded, setLoaded] = useState(false);
  const readyToSave = useRef(false);
  const fromServer = useRef(false);

  useEffect(() => {
    const savedUser = window.localStorage.getItem(currentUserKey);

    if (savedUser) setCurrentPersonState(savedUser);
    loadStore<PayPlan[]>("payplans").then((parsed) => {
      if (Array.isArray(parsed)) {
        setPayPlans(migratePayPlans(parsed));
      }
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
    // Compare-and-swap: pay plans are money — a stale tab must never clobber
    // an edit another admin just made. Losing the race = adopt the server copy.
    void saveStoreGuarded<PayPlan[]>("payplans", payPlans).then((result) => {
      if (result.ok || result.conflict !== true) return;
      if (Array.isArray(result.value)) setPayPlans(migratePayPlans(result.value));
    });
  }, [payPlans, loaded]);

  // Fresh on open: a pay-plan change made at the desk shows on the waking phone.
  useRefreshOnWake(() => {
    if (!loaded) return;
    void loadStore<PayPlan[]>("payplans").then((parsed) => {
      if (!Array.isArray(parsed)) return;
      setPayPlans((current) => {
        const next = migratePayPlans(parsed);
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        fromServer.current = true;
        return next;
      });
    });
  });

  function setCurrentPerson(person: string) {
    setCurrentPersonState(person);
    window.localStorage.setItem(currentUserKey, person);
  }

  const value = useMemo(
    () => ({
      currentPerson,
      setCurrentPerson,
      payPlans,
      savePayPlan: (plan: PayPlan) =>
        setPayPlans((current) => {
          const withoutExisting = current.filter((item) => !(item.personName === plan.personName && item.role === plan.role));
          return [...withoutExisting, plan].sort((a, b) => a.personName.localeCompare(b.personName));
        }),
      savePayPlans: (plans: PayPlan[]) =>
        setPayPlans((current) => {
          const incomingKeys = new Set(plans.map((plan) => `${plan.role}:${plan.personName}`));
          const untouched = current.filter((plan) => !incomingKeys.has(`${plan.role}:${plan.personName}`));
          return [...untouched, ...plans].sort((a, b) => `${a.role}:${a.personName}`.localeCompare(`${b.role}:${b.personName}`));
        }),
      resetPayPlans: () => setPayPlans(defaultPayPlans),
    }),
    [currentPerson, payPlans]
  );

  return <PayPlanContext.Provider value={value}>{children}</PayPlanContext.Provider>;
}

export function usePayPlans() {
  const context = useContext(PayPlanContext);
  if (!context) {
    throw new Error("usePayPlans must be used inside PayPlanProvider");
  }
  return context;
}

// SAVED PLANS ARE TRUTH: the old version seeded every Kennesaw default plan
// first, so a deleted plan resurrected on the next load and every other tenant
// inherited Kennesaw people. Now defaults only seed when NOTHING is saved.
function migratePayPlans(parsed: PayPlan[]) {
  const byKey = new Map<string, PayPlan>();
  if (parsed.length === 0) defaultPayPlans.forEach((plan) => byKey.set(`${plan.role}:${plan.personName}`, plan));
  parsed.forEach((plan) => {
    const personName = canonicalPersonName(plan.personName);
    // Older saved Sales plans predate the structured sales plan — backfill the
    // Kennesaw default so their commission still computes (and stays unchanged).
    const sales = plan.role === "Sales" ? { ...defaultSalesPlan, ...(plan.sales || {}) } : plan.sales;
    byKey.set(`${plan.role}:${personName}`, { ...plan, personName, sales });
  });
  return Array.from(byKey.values()).sort((a, b) => `${a.role}:${a.personName}`.localeCompare(`${b.role}:${b.personName}`));
}
