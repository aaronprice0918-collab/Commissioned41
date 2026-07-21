// The fixed, viewport-anchored glow + drifting orbs that sit behind all content.
// Lives once in the root layout so every page shares the same atmosphere.
export function AmbientField() {
  return (
    <div aria-hidden className="ambient-field pointer-events-none fixed inset-0 -z-10">
      <div
        className="ambient-orb absolute left-[-10%] top-[6%] h-[42vw] w-[42vw] rounded-full bg-mission-green/10 blur-[120px]"
        style={{ animation: "orbDrift 22s ease-in-out infinite" }}
      />
      <div
        className="ambient-orb absolute right-[-8%] top-[42%] h-[34vw] w-[34vw] rounded-full bg-mission-crimson/[0.06] blur-[120px]"
        style={{ animation: "orbDrift2 26s ease-in-out infinite" }}
      />
      <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(120,170,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(120,170,255,.6)_1px,transparent_1px)] [background-size:54px_54px]" />
    </div>
  );
}
