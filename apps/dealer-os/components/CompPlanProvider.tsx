"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";
import { useRefreshOnWake } from "@/lib/useRefreshOnWake";
import type { CompPlan } from "@/lib/payEngine";

// A saved pay plan authored in the Pay Plan Studio. `active` + `role` decide
// whose live scorecard it drives: at most one active plan per role. When a role
// has an active plan, that plan (run through the engine) becomes the live pay
// calculation for people in that role, replacing the built-in defaults.
export type StoredCompPlan = CompPlan & {
  role?: string;
  active?: boolean;
  planType?: string;
  confidence?: string;
  notes?: string;
  summary?: string;
};

type CompPlanCtx = {
  plans: StoredCompPlan[];
  loaded: boolean;
  savePlan: (plan: StoredCompPlan) => void;
  deletePlan: (id: string) => void;
  activatePlan: (id: string) => void; // activates for its role, deactivates siblings
  deactivateRole: (role: string) => void;
  activePlanFor: (role?: string) => StoredCompPlan | null;
};

const Ctx = createContext<CompPlanCtx | null>(null);

export function CompPlanProvider({ children }: { children: React.ReactNode }) {
  const [plans, setPlans] = useState<StoredCompPlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const readyToSave = useRef(false);
  const fromServer = useRef(false);

  useEffect(() => {
    loadStore<StoredCompPlan[]>("compPlans").then((parsed) => {
      if (Array.isArray(parsed)) setPlans(parsed);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!readyToSave.current) { readyToSave.current = true; return; }
    if (fromServer.current) { fromServer.current = false; return; }
    // Compare-and-swap: comp plans drive live pay — a stale tab must never
    // clobber them. Losing the race = adopt the server copy.
    void saveStoreGuarded<StoredCompPlan[]>("compPlans", plans).then((result) => {
      if (result.ok || result.conflict !== true) return;
      if (Array.isArray(result.value)) setPlans(result.value);
    });
  }, [plans, loaded]);

  // Fresh on open: comp plans drive live pay — re-read them on wake.
  useRefreshOnWake(() => {
    if (!loaded) return;
    void loadStore<StoredCompPlan[]>("compPlans").then((parsed) => {
      if (!Array.isArray(parsed)) return;
      setPlans((current) => {
        if (JSON.stringify(parsed) === JSON.stringify(current)) return current;
        fromServer.current = true;
        return parsed;
      });
    });
  });

  const value = useMemo<CompPlanCtx>(
    () => ({
      plans,
      loaded,
      savePlan: (plan) => setPlans((cur) => [...cur.filter((p) => p.id !== plan.id), plan]),
      deletePlan: (id) => setPlans((cur) => cur.filter((p) => p.id !== id)),
      activatePlan: (id) =>
        setPlans((cur) => {
          const target = cur.find((p) => p.id === id);
          if (!target) return cur;
          return cur.map((p) => (p.role && p.role === target.role ? { ...p, active: p.id === id } : p.id === id ? { ...p, active: true } : p));
        }),
      deactivateRole: (role) => setPlans((cur) => cur.map((p) => (p.role === role ? { ...p, active: false } : p))),
      activePlanFor: (role) => (role ? plans.find((p) => p.active && p.role === role) ?? null : null),
    }),
    [plans, loaded],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompPlans() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCompPlans must be used inside CompPlanProvider");
  return ctx;
}
