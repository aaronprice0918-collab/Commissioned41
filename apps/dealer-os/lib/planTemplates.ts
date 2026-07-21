// ── Seeded plan templates ────────────────────────────────────────────────────
// The built-in starting plans a store falls back to when it hasn't activated its
// own in the Pay Plan Studio. Today only the automotive dealership ships
// templates (Kennesaw's F&I grid + sales plan); other industries author their
// own from a document/spreadsheet. Nothing here is a hidden assumption baked into
// the engine — it's just the default seed for the dealership vertical.
import type { CompPlan } from "./payEngine";
import { FINANCE_COMP_PLAN } from "./financePayPlan";
import { KENNESAW_SALES_COMP_PLAN } from "./salesCompPlan";

export const AUTOMOTIVE_FI_TEMPLATE = FINANCE_COMP_PLAN;
export const AUTOMOTIVE_SALES_TEMPLATE = KENNESAW_SALES_COMP_PLAN;

// The seeded default plan for a role, used only when no store-authored plan is
// active for that role. Returns null when there's no built-in template (the
// caller then tells the user to author one in the Studio).
export function templateForRole(role?: string): CompPlan | null {
  if (role === "F&I") return AUTOMOTIVE_FI_TEMPLATE;
  if (role === "Sales") return AUTOMOTIVE_SALES_TEMPLATE;
  return null;
}
