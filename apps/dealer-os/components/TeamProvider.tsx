"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { canonicalPersonName, team } from "@/lib/data";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";
import { useRefreshOnWake } from "@/lib/useRefreshOnWake";

export type TeamLists = {
  salespeople: string[];
  managers: string[];
  financeManagers: string[];
  lienholders: string[];
};

type TeamContextValue = TeamLists & {
  updateTeamLists: (lists: TeamLists) => void;
  resetTeamLists: () => void;
};

export const defaultTeamLists: TeamLists = {
  salespeople: team.filter((member) => member.role === "Sales" || member.role === "BDC").map((member) => member.name),
  managers: team.filter((member) => member.role === "Manager").map((member) => member.name),
  financeManagers: team.filter((member) => member.role === "F&I").map((member) => member.name),
  lienholders: [
    "Mazda Financial",
    "Capital One",
    "Chase",
    "Wells Fargo",
    "Ally",
    "Navy Federal",
    "Global Lending",
    "Bank of America",
    "Truist",
    "Georgia's Own Credit Union",
    "LGE Community Credit Union",
    "Cash",
  ],
};

const TeamContext = createContext<TeamContextValue | null>(null);

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const [lists, setLists] = useState<TeamLists>(defaultTeamLists);
  const [loaded, setLoaded] = useState(false);
  const readyToSave = useRef(false);
  const fromServer = useRef(false);

  useEffect(() => {
    loadStore<TeamLists>("team").then((parsed) => {
      if (parsed && Array.isArray(parsed.salespeople) && Array.isArray(parsed.managers) && Array.isArray(parsed.financeManagers)) {
        setLists(migrateTeamLists(parsed));
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
    // Compare-and-swap: a stale tab must never overwrite a roster another
    // admin just changed. Losing the race = adopt the server copy.
    void saveStoreGuarded<TeamLists>("team", lists).then((result) => {
      if (result.ok || result.conflict !== true) return;
      if (result.value) setLists(migrateTeamLists(result.value));
    });
  }, [lists, loaded]);

  // Fresh on open: a waking phone re-reads the roster instead of trusting a
  // memory of the last visit. Adopts only when the server copy differs.
  useRefreshOnWake(() => {
    if (!loaded) return;
    void loadStore<TeamLists>("team").then((parsed) => {
      if (!parsed || !Array.isArray(parsed.salespeople)) return;
      setLists((current) => {
        const next = migrateTeamLists(parsed);
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        fromServer.current = true;
        return next;
      });
    });
  });

  const value = useMemo(
    () => ({
      ...lists,
      updateTeamLists: (next: TeamLists) => setLists(next),
      resetTeamLists: () => setLists(defaultTeamLists),
    }),
    [lists]
  );

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

export function useTeamLists() {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error("useTeamLists must be used inside TeamProvider");
  }
  return context;
}

function mergeUnique(first: string[], second: string[]) {
  return Array.from(new Set([...first, ...second].filter(Boolean)));
}

function cleanFinanceManagers(source: string[]) {
  const names = source.map((name) => canonicalPersonName(name));
  return Array.from(new Set(names));
}

function hasAny(source: string[], targets: string[]) {
  return targets.some((target) => source.includes(target));
}

// SAVED ROSTER IS TRUTH. The old version merged the hardcoded Kennesaw roster
// back into any list that lacked its sentinel names — which meant every OTHER
// tenant got Kennesaw's staff injected on load, and a deleted employee
// resurrected forever. Now: a non-empty saved list is used as-is (names
// canonicalized, the one legacy short-name roster upgraded); defaults only
// seed a list that is genuinely EMPTY (fresh store).
function migrateTeamLists(parsed: TeamLists): TeamLists {
  const rawSalespeople = Array.isArray(parsed.salespeople) ? parsed.salespeople : [];
  const rawManagers = Array.isArray(parsed.managers) ? parsed.managers : [];
  const rawFinanceManagers = Array.isArray(parsed.financeManagers) ? parsed.financeManagers : [];
  const salespeople = rawSalespeople.map((name) => canonicalPersonName(name)).filter(Boolean);
  const managers = rawManagers.map((name) => canonicalPersonName(name)).filter(Boolean);
  const financeManagers = cleanFinanceManagers(rawFinanceManagers).filter(Boolean);
  const lienholders = Array.isArray(parsed.lienholders) ? parsed.lienholders.filter(Boolean) : [];
  // The one true migration: Kennesaw's original short-name roster upgrades to
  // full names. Detected by its exact markers; touches nobody else.
  const legacySalesRoster = hasAny(rawSalespeople, ["Tony", "Watson", "Daniel"]) && !hasAny(rawSalespeople, ["Anthony Williams II", "Watson Jones", "Daniel Maharaj"]);
  const legacyManagerRoster = hasAny(rawManagers, ["Brunno", "Daryl", "Paul"]) && !hasAny(rawManagers, ["Brunno Nakamura", "Daryl NeSmith", "Paul Miller"]);
  const legacyFinanceRoster = hasAny(rawFinanceManagers, ["AARON PRICE", "Bo"]) && !hasAny(rawFinanceManagers, ["Aaron Price", "Bo Tshuma"]);

  return {
    salespeople: legacySalesRoster ? defaultTeamLists.salespeople : salespeople.length ? salespeople : defaultTeamLists.salespeople,
    managers: legacyManagerRoster ? defaultTeamLists.managers : managers.length ? managers : defaultTeamLists.managers,
    financeManagers: legacyFinanceRoster ? defaultTeamLists.financeManagers : financeManagers.length ? financeManagers : defaultTeamLists.financeManagers,
    lienholders: lienholders.length ? lienholders : defaultTeamLists.lienholders,
  };
}
