"use client";

import Image from "next/image";
import clsx from "clsx";

export const kennesawMazdaLogo = "/brand/kennesaw-mazda-premium.jpg";

export function KennesawMazdaMark({
  className,
  compact = false,
  priority = false,
}: {
  className?: string;
  compact?: boolean;
  priority?: boolean;
}) {
  return (
    <div
      className={clsx(
        "pointer-events-none relative isolate overflow-hidden rounded-[12px] border border-white/14 bg-gradient-to-br from-white via-[#f4f5f7] to-[#cbd1d9] shadow-[0_24px_80px_rgba(220,226,236,0.18)]",
        compact ? "p-1.5" : "p-3",
        className
      )}
      aria-label="Kennesaw Mazda"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.95),rgba(255,255,255,0.1)_52%,rgba(0,0,0,0.06))]" />
      <Image
        src={kennesawMazdaLogo}
        alt="Kennesaw Mazda"
        fill
        sizes={compact ? "180px" : "680px"}
        className={clsx("relative object-contain object-center", compact ? "p-1" : "p-2")}
        priority={priority}
      />
    </div>
  );
}

export const missionMark = "/brand/mission-mark.png";
export const missionLogo = "/brand/mission-logo.png";

// The real Mission "M" — diamond-cut chrome brand mark, supplied as artwork on a
// transparent background so it drops cleanly onto any dark surface.
export function MissionMark({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <div className={clsx("pointer-events-none relative", className)} aria-label="Mission" role="img">
      <Image
        src={missionMark}
        alt="Mission"
        fill
        sizes="160px"
        className="mission-chrome-art pointer-events-none object-contain object-center"
        priority={priority}
      />
    </div>
  );
}

// The Dealer Mission OS wordmark — a "DEALER" eyebrow over the locked chrome
// "MISSION" + steel-blue "OS" signature. "Mission OS" is the platform family
// (Commissioned 41 will ship more than one OS); "Dealer" is this product line,
// so the eyebrow carries the qualifier and the core mark stays untouched and
// reusable. Size/tracking come from the parent via className; the eyebrow is
// sized in `em` so it scales with the wordmark at every placement.
// Pass `eyebrow={false}` for very small inline placements (e.g. the app header)
// where the qualifier would be illegible — there the core MISSION OS mark stands
// on its own.
export function MissionWordmark({ className, eyebrow = true }: { className?: string; eyebrow?: boolean }) {
  const core = (
    <span className={clsx("font-display font-black leading-none", !eyebrow && className)} aria-label={eyebrow ? undefined : "Mission OS"}>
      <span
        className="bg-clip-text text-transparent"
        style={{ backgroundImage: "linear-gradient(180deg,#ffffff,#c4cad2 55%,#7f868f)" }}
      >
        MISSION
      </span>
      <span className="text-mission-green" style={{ textShadow: "0 0 14px rgb(96 150 255 / 0.55)" }}>
        OS
      </span>
    </span>
  );

  if (!eyebrow) return core;

  return (
    <span className={clsx("inline-flex flex-col items-start leading-none", className)} aria-label="Dealer Mission OS">
      <span
        className="font-display font-black uppercase text-mission-green/85"
        style={{ fontSize: "0.34em", letterSpacing: "0.42em", marginBottom: "0.34em", textShadow: "0 0 10px rgb(96 150 255 / 0.4)" }}
      >
        Dealer
      </span>
      {core}
    </span>
  );
}

// Full Mission lockup — the chrome M above the "MISSION" wordmark.
export function MissionLockup({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <div className={clsx("pointer-events-none relative", className)} aria-label="Mission" role="img">
      <Image
        src={missionLogo}
        alt="Mission"
        fill
        sizes="420px"
        className="mission-chrome-art pointer-events-none object-contain object-center"
        priority={priority}
      />
    </div>
  );
}
