import clsx from "clsx";
import { Tilt } from "@/components/Tilt";

type MetricCardProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: "gold" | "green" | "red" | "blue";
  className?: string;
  onClick?: () => void;
  // Tap-to-explain law: hand this number to EILA ("Explain my <number>…").
  // With onClick too, it renders as a small "ask EILA why" chip beside the
  // drill affordance; alone, the whole card taps through to EILA.
  onExplain?: () => void;
};

const accent = {
  gold: "text-mission-gold",
  green: "text-mission-green",
  red: "text-mission-red",
  blue: "text-white",
};

// A living glass pane: it tilts toward your touch (light follows your finger via
// the specular), a glare sweeps across it, and the edge breathes. Used on every
// screen, so the whole app feels alive and touchable — not static.
export function MetricCard({ label, value, detail, tone = "blue", className, onClick, onExplain }: MetricCardProps) {
  const interactive = Boolean(onClick || onExplain);
  return (
    <Tilt
      onClick={onClick ?? onExplain}
      className={clsx(
        "group relative overflow-hidden glass-panel glass-tactile glass-float p-5",
        interactive && "cursor-pointer",
        className
      )}
    >
      <span className="glass-sweep" aria-hidden />
      <div className="readable-text text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">{label}</div>
      <div className={clsx("readable-text mt-3 font-display text-[clamp(1.6rem,2.4vw,2.4rem)] font-black leading-none tracking-tight", accent[tone])}>{value}</div>
      {detail && <div className="readable-text mt-2 text-xs leading-5 text-white/50">{detail}</div>}
      {interactive && (
        <div className="readable-text mt-3 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.18em]">
          {onClick && <span className="text-mission-gold/0 transition group-hover:text-mission-gold/70">open &rarr;</span>}
          {onExplain && (onClick ? (
            // Faintly visible always (phones don't hover) so the question is discoverable.
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onExplain(); }}
              className="relative z-10 text-white/30 transition hover:text-mission-gold group-hover:text-white/60"
            >
              ask EILA why
            </button>
          ) : (
            <span className="text-white/30 transition group-hover:text-mission-gold/70">ask EILA why &rarr;</span>
          ))}
        </div>
      )}
    </Tilt>
  );
}
