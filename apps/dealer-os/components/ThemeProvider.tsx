"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export const themes = [
  { key: "sky", label: "Sky Command" }, // THE STANDARD (Aaron, July 8 2026) — white cards, one blue
  { key: "glass", label: "Glass HUD" },
  { key: "command", label: "Platinum" },
  { key: "graphite", label: "Graphite Platinum" },
  { key: "showroom", label: "Showroom Steel" },
  { key: "executive", label: "Executive Teal" },
  { key: "rose", label: "Rose Platinum" },
  { key: "gotham", label: "Gotham" },
  { key: "superman", label: "Superman" },
  { key: "hulk", label: "Hulk" },
] as const;

export type ThemeKey = (typeof themes)[number]["key"];

type ThemeContextValue = {
  theme: ThemeKey;
  setTheme: (theme: ThemeKey) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const storageKey = "commissioned41-theme";

function isThemeKey(value: string | null): value is ThemeKey {
  return themes.some((theme) => theme.key === value);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeKey>("sky");

  useEffect(() => {
    // Sky is the standard (Aaron, July 8 2026). One-time migration: the old
    // provider auto-WROTE "glass" to storage on first mount, so a stored
    // "glass" can't be told apart from a deliberate choice — everyone moves to
    // Sky once, and any theme they pick after that sticks like always.
    const migrated = window.localStorage.getItem("c41-sky-standard") === "1";
    const stored = window.localStorage.getItem(storageKey);
    if (!migrated) {
      window.localStorage.setItem("c41-sky-standard", "1");
      setThemeState("sky");
      return;
    }
    if (isThemeKey(stored)) setThemeState(stored);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(storageKey, theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme: setThemeState }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
