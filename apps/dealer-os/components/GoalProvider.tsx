"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { canonicalPersonName, goals as defaultStoreGoals, team } from "@/lib/data";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";
import { useRefreshOnWake } from "@/lib/useRefreshOnWake";

export type SalesGoals = {
  teamDeliveredUnits: number;
  salespersonUnits: Record<string, number>;
  // Per-F&I-manager PVR/PPU targets (by canonical name). Absent/0 = fall back
  // to the store-wide targets in storeSettings — these are per-person raises
  // of the bar, not a replacement for the store goal.
  financeTargets?: Record<string, { pvr?: number; ppu?: number }>;
};

type GoalContextValue = {
  goals: SalesGoals;
  updateGoals: (goals: SalesGoals) => void;
  resetGoals: () => void;
};

export const defaultSalesGoals: SalesGoals = {
  teamDeliveredUnits: defaultStoreGoals.deliveredUnits,
  salespersonUnits: Object.fromEntries(
    team
      .filter((member) => member.role === "Sales" && member.unitGoal)
      .map((member) => [member.name, member.unitGoal || 0])
  ),
};

const GoalContext = createContext<GoalContextValue | null>(null);

export function GoalProvider({ children }: { children: React.ReactNode }) {
  const [goals, setGoals] = useState<SalesGoals>(defaultSalesGoals);
  const [loaded, setLoaded] = useState(false);
  const readyToSave = useRef(false);
  const fromServer = useRef(false);

  useEffect(() => {
    loadStore<SalesGoals>("goals").then((saved) => {
      if (saved && typeof saved === "object") {
        setGoals({
          teamDeliveredUnits: Number(saved.teamDeliveredUnits) || defaultSalesGoals.teamDeliveredUnits,
          salespersonUnits: mergeGoalDefaults(saved.salespersonUnits && typeof saved.salespersonUnits === "object" ? saved.salespersonUnits : {}),
          financeTargets: saved.financeTargets && typeof saved.financeTargets === "object" ? saved.financeTargets : {},
        });
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
    // Compare-and-swap: goals must never be clobbered by a stale tab's
    // week-old copy. Losing the race = adopt the server copy.
    void saveStoreGuarded<SalesGoals>("goals", goals).then((result) => {
      if (result.ok || result.conflict !== true) return;
      if (result.value && typeof result.value === "object") setGoals(result.value);
    });
  }, [goals, loaded]);

  // Fresh on open: goals set on another device show the moment the app wakes.
  useRefreshOnWake(() => {
    if (!loaded) return;
    void loadStore<SalesGoals>("goals").then((saved) => {
      if (!saved || typeof saved !== "object") return;
      setGoals((current) => {
        const next = {
          teamDeliveredUnits: Number(saved.teamDeliveredUnits) || defaultSalesGoals.teamDeliveredUnits,
          salespersonUnits: mergeGoalDefaults(saved.salespersonUnits && typeof saved.salespersonUnits === "object" ? saved.salespersonUnits : {}),
          financeTargets: saved.financeTargets && typeof saved.financeTargets === "object" ? saved.financeTargets : {},
        };
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        fromServer.current = true;
        return next;
      });
    });
  });

  const value = useMemo(
    () => ({
      goals,
      updateGoals: setGoals,
      resetGoals: () => setGoals(defaultSalesGoals),
    }),
    [goals]
  );

  return <GoalContext.Provider value={value}>{children}</GoalContext.Provider>;
}

// SAVED GOALS ARE TRUTH: a non-empty saved map is used as-is (the old spread
// of Kennesaw's default names injected the founding store's reps into every
// tenant and resurrected removed reps forever). Defaults only seed an empty
// map; the one legacy short-name migration still upgrades.
function mergeGoalDefaults(saved: Record<string, number>) {
  const legacyKeys = ["Tony", "Watson", "Daniel", "Joe", "Rick", "Noel", "Greg", "Shawn S", "Shaun H", "Joshua", "Maged", "El"];
  const normalizedSaved = Object.fromEntries(Object.entries(saved).map(([name, goal]) => [canonicalPersonName(name), goal]));
  const hasLegacyOnly = legacyKeys.some((key) => key in saved) && !("Anthony Williams II" in normalizedSaved);
  if (hasLegacyOnly) return defaultSalesGoals.salespersonUnits;
  return Object.keys(normalizedSaved).length ? normalizedSaved : defaultSalesGoals.salespersonUnits;
}

export function useSalesGoals() {
  const context = useContext(GoalContext);
  if (!context) {
    throw new Error("useSalesGoals must be used inside GoalProvider");
  }
  return context;
}
