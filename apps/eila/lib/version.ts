// The build id baked into THIS running bundle at deploy time (the commit SHA on
// Vercel, "dev" locally). /api/version returns the LIVE deploy's id at request
// time; when they differ, this phone is running an older cached version.
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

// Only prompt to update when BOTH ids are real deploy ids and they differ.
// Local dev ("dev"), an unknown/empty server value, or a matching id never
// prompt — so we never nag on a transient blip or a local build.
export function isNewerVersionAvailable(clientBuild: string, serverBuild: string): boolean {
  if (!clientBuild || !serverBuild) return false;
  if (clientBuild === "dev" || serverBuild === "dev" || serverBuild === "unknown") return false;
  return clientBuild !== serverBuild;
}
