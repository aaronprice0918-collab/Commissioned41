import type { Deal } from "./types";

// A PRODUCT-ONLY deal: backend products / back gross sold with NO core sale (no
// vehicle) — e.g. a walk-in buys a VSC + appearance package. Its secondary gross
// and add-ons STILL count toward the per-unit averages (PVR/PPU), but it is NOT a
// unit. Detected by an EXPLICIT flag, not a heuristic: in this neutral model an
// F&I user's normal deal also has amount 0 (they log only back gross), so amount
// alone cannot mean "no vehicle". (Aaron / EILA report, July 2026.)
// Kept dependency-free so every layer (engine, fni, spiffs, pay) can import it.
export function isProductOnly(d: Deal): boolean {
  return d.productOnly === true;
}
