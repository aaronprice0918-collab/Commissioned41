export const ownerEmail = process.env.NEXT_PUBLIC_OWNER_EMAIL || "aaronprice0918@gmail.com";
// Product owner (vendor) super-admin: always retains owner access on every
// deployed instance, independent of per-instance env config. Prevents an
// owner lockout if NEXT_PUBLIC_OWNER_EMAIL is missing or mistyped.
const productOwnerEmail = "aaronprice0918@gmail.com";
const ownerEmails = [
  ownerEmail,
  productOwnerEmail,
  process.env.NEXT_PUBLIC_OWNER_EMAILS || "",
  "aprice@kennesawmazda.com",
  // Aaron's master login — one owner identity across every C41 product.
  "aaronprice@commissioned41.com",
]
  .join(",")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export type AccessRole = "Admin" | "Manager" | "F&I" | "Sales" | "BDC";

export function isOwnerEmail(email?: string | null) {
  return ownerEmails.includes((email || "").trim().toLowerCase());
}

export function normalizeAccessRole(value?: string | null): AccessRole {
  const cleaned = (value || "Sales").trim().toLowerCase();
  if (cleaned.includes("admin")) return "Admin";
  if (cleaned.includes("manager")) return "Manager";
  if (cleaned.includes("bdc")) return "BDC";
  if (cleaned === "f&i" || cleaned === "fi" || cleaned.includes("finance")) return "F&I";
  return "Sales";
}

// ── Store write authorization ────────────────────────────────────────────────
// The minimal profile shape the store route resolves from Supabase auth and uses
// for the access matrix. Kept here (not the route) so the matrix is unit-testable
// in isolation and the route imports a single source of truth.
export type StoreProfile = {
  email: string;
  role: string;
  employeeName: string;
  orgId?: string;
};

export function isAdmin(profile?: StoreProfile) {
  return profile?.role === "Admin" || isOwnerEmail(profile?.email);
}

// Who may WRITE each store key. This is security-critical: the server uses the
// Supabase service-role key, which bypasses row-level security, so this matrix is
// the ONLY thing standing between a role and a forbidden write. It is default-deny:
// any (key, role) pair not explicitly allowed below is rejected.
export function canWrite(key: string, profile?: StoreProfile) {
  // File-store / dev path (no Supabase) — profile is undefined; preserve the
  // unauthenticated local-dev convenience. Production always has a profile here.
  if (!profile) return true;
  if (key === "missionCore" || key === "hqPipeline") return isAdmin(profile);
  // Store financial config (doc fee, holdback, tax, weights, targets) is
  // admin-only. All roles may READ it (the client math depends on it).
  if (key === "payplans" || key === "team" || key === "storeSettings" || key === "monthlySetup") return isAdmin(profile);
  if (key === "goals") return isAdmin(profile) || profile?.role === "Manager";
  // Closing the month archives the whole board — same people who can close it
  // in the UI (owner/admin/manager) may write the archive.
  if (key === "closedMonths") return isAdmin(profile) || profile?.role === "Manager";
  if (key === "deals") return isAdmin(profile) || profile?.role === "Manager" || profile?.role === "F&I";
  // deals_backup is the import snapshot; the import page is gated to owner/admin,
  // so only admins ever write it.
  if (key === "deals_backup") return isAdmin(profile);
  // The service lane is worked by every role that can touch the drive
  // (advisors don't have their own role yet — Manager/F&I/Admin write it;
  // Sales/BDC read it for the sales-opportunity flags).
  if (key === "serviceLane") return isAdmin(profile) || profile?.role === "Manager" || profile?.role === "F&I";
  // Parts counter rides the same gate until a Parts role exists on user_profiles.
  if (key === "partsCounter") return isAdmin(profile) || profile?.role === "Manager" || profile?.role === "F&I";
  // Team chat, CRM leads, and profile photos are used by every role; per-record
  // authorship is enforced downstream in the merge* helpers, not here.
  if (key === "messages" || key === "conversations" || key === "crmLeads" || key === "photos") return true;
  // Default-deny: any (key, role) pair not explicitly allowed above is rejected.
  // Service-role bypasses RLS, so an unenumerated combo must not fall through to
  // an allowed write.
  return false;
}
