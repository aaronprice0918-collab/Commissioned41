// Pure owner check — no server imports, safe to use in client components.
// The REAL gate is server-side (/api/owner/pulse re-checks with the same
// list); this only decides whether to SHOW the owner link, so having the
// owner email in the client bundle is fine (it's an address, not a secret).
const DEFAULT_OWNER = "aaronprice@commissioned41.com";

export function isOwner(
  email: string,
  raw = (typeof process !== "undefined" && (process.env.OWNER_EMAILS || process.env.NEXT_PUBLIC_OWNER_EMAILS)) || DEFAULT_OWNER,
): boolean {
  if (!email) return false;
  return raw.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean).includes(email.toLowerCase());
}
