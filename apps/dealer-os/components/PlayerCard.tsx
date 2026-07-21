import type { ReactNode } from "react";
import { displayPersonName } from "@/lib/data";

// The premium living "player card" — the shared form for a teammate's business
// card (identity) and scorecard (stats). Signature green living-border rim + a
// holographic sheen sweeping across, chrome DEALER MISSION OS mark, avatar, name, role.
export function PlayerCard({
  name,
  role,
  sub,
  photo,
  topLabel,
  topRight,
  children,
  className,
}: {
  name: string;
  role: string;
  sub?: string;
  photo: ReactNode;
  topLabel?: string;
  topRight?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`player-card living-border card-sheen relative overflow-hidden rounded-[22px] ${className || ""}`}
      style={{ background: "linear-gradient(160deg, rgb(16 28 48 / 0.95), rgb(7 12 22 / 0.97))" }}
    >
      <div className="relative z-[2] p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="font-display text-[10px] font-black tracking-[0.22em] text-white/45">
            DEALER MISSION<span className="text-mission-green"> OS</span>{topLabel ? ` · ${topLabel}` : ""}
          </span>
          {topRight}
        </div>
        <div className="mt-4 flex flex-col items-center text-center">
          {photo}
          <div className="mt-3 font-display text-2xl font-black leading-tight text-white">{displayPersonName(name)}</div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-mission-green">{role}</div>
          {sub && <div className="mt-0.5 text-xs text-white/45">{sub}</div>}
        </div>
        <div className="my-4 h-px bg-gradient-to-r from-transparent via-mission-green/45 to-transparent" />
        {children}
      </div>
    </div>
  );
}
