"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultStoreSettings,
  mergeStoreSettings,
  setActiveStoreSettings,
  type StoreSettings,
} from "@/lib/data";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";
import { useRefreshOnWake } from "@/lib/useRefreshOnWake";

type StoreSettingsContextValue = {
  settings: StoreSettings;
  updateSettings: (settings: StoreSettings) => void;
  resetSettings: () => void;
  loaded: boolean;
};

const StoreSettingsContext = createContext<StoreSettingsContextValue | null>(null);

// Keep the module cache primed with the Kennesaw/GA defaults at import time so
// the math in lib/data.ts is correct on first paint, before the store loads.
setActiveStoreSettings(defaultStoreSettings);

export function StoreSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
  const [loaded, setLoaded] = useState(false);
  const readyToSave = useRef(false);
  const fromServer = useRef(false);

  // Push every settings change into the data.ts cache so the pure math
  // functions (docFeeIncome / manufacturerMoney / productUnits) read this org's
  // constants. Runs synchronously on each render before children compute.
  setActiveStoreSettings(settings);

  useEffect(() => {
    loadStore<Partial<StoreSettings>>("storeSettings").then((saved) => {
      const merged = mergeStoreSettings(saved);
      setActiveStoreSettings(merged);
      setSettings(merged);
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
    // Compare-and-swap: store economics (doc fee, tax, targets) must never be
    // clobbered by a stale tab. Losing the race = adopt the server copy.
    void saveStoreGuarded<StoreSettings>("storeSettings", settings).then((result) => {
      if (result.ok || result.conflict !== true) return;
      if (result.value) {
        const merged = mergeStoreSettings(result.value);
        setActiveStoreSettings(merged);
        setSettings(merged);
      }
    });
  }, [settings, loaded]);

  // Fresh on open: store constants changed on another device (doc fee, tax,
  // targets) land the moment the app wakes.
  useRefreshOnWake(() => {
    if (!loaded) return;
    void loadStore<Partial<StoreSettings>>("storeSettings").then((saved) => {
      if (!saved || typeof saved !== "object") return;
      setSettings((current) => {
        const merged = mergeStoreSettings(saved);
        if (JSON.stringify(merged) === JSON.stringify(current)) return current;
        fromServer.current = true;
        setActiveStoreSettings(merged);
        return merged;
      });
    });
  });

  const value = useMemo(
    () => ({
      settings,
      updateSettings: (next: StoreSettings) => setSettings(next),
      resetSettings: () => setSettings(defaultStoreSettings),
      loaded,
    }),
    [settings, loaded]
  );

  return <StoreSettingsContext.Provider value={value}>{children}</StoreSettingsContext.Provider>;
}

export function useStoreSettings() {
  const context = useContext(StoreSettingsContext);
  if (!context) {
    throw new Error("useStoreSettings must be used inside StoreSettingsProvider");
  }
  return context;
}
