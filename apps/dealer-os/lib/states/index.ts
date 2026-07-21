import { type StateTaxProfile } from "./types";
import { GA } from "./ga";
import { FL } from "./fl";
import { TX } from "./tx";

export { type StateTaxProfile } from "./types";
export { assertQuotable } from "./types";

// The registry. Each state is its own isolated module; this only maps code →
// profile. Adding a state = adding a file + one line here. Nothing here can
// change a state's numbers — those live only in the state's own file.
export const STATE_PROFILES: Record<string, StateTaxProfile> = {
  GA,
  FL,
  TX,
};

// Georgia is the default so every existing caller (which never passed a state)
// behaves exactly as before this refactor.
export const DEFAULT_STATE = "GA";

export function getStateProfile(code?: string | null): StateTaxProfile {
  const key = (code || DEFAULT_STATE).toUpperCase();
  return STATE_PROFILES[key] || STATE_PROFILES[DEFAULT_STATE];
}

export function isStateVerified(code?: string | null): boolean {
  return getStateProfile(code).status === "verified";
}

// For the UI: which states can we actually sell/quote in today, and which are
// in the pipeline. Drives an honest "supported states" list.
export function listStates() {
  const all = Object.values(STATE_PROFILES);
  return {
    verified: all.filter((s) => s.status === "verified").map((s) => s.code),
    review: all.filter((s) => s.status === "review").map((s) => s.code),
  };
}
