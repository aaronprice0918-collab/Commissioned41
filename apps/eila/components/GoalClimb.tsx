"use client";

// The Climb — the bold Home-page money-goal read. One glance: how deep in the draw, where
// I stand, how far to my take-home goal. Built on the "goal-gradient" idea — the
// summit pulls you in, milestones are small wins. Take-home axis so the number on
// the flag is what lands in the bank; the draw break-even is the first checkpoint.
// Shows on its own: with a goal it climbs to the goal; without one it shows the
// break-even checkpoint and nudges you to set a goal.

import { Flag, Mountain } from "lucide-react";
import { CountUp } from "./motion";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const short = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : money(n));

// Horizontal alignment for a point-label on the ramp, keyed off how far along
// the climb (0–100%) the point sits. Near the bottom-left start the label reads
// rightward (0%) so it can't run off the card; near the summit it reads leftward
// (-100%) so it clears the flag; centered (-50%) through the middle.
const labelShift = (p: number) => (p < 15 ? "0%" : p > 85 ? "-100%" : "-50%");

export function GoalClimb({
  takeHome, // current take-home earned this month ($ after tax)
  goal, // take-home goal ($); 0/undefined = not set yet
  taxRate, // % — to convert the gross draw into a take-home checkpoint
  draw, // this month's draw ($ gross)
  drawOwed, // $ still owed on the (rolling) draw — the hole
  onAsk,
}: {
  takeHome: number;
  goal: number;
  taxRate: number;
  draw: number;
  drawOwed: number;
  onAsk?: () => void;
}) {
  const breakEvenTH = draw * (1 - (taxRate || 0) / 100); // take-home level where the draw is cleared
  const hasGoal = goal > 0;
  const summit = Math.max(hasGoal ? goal : breakEvenTH, 1);
  const pct = Math.max(0, Math.min(100, (takeHome / summit) * 100));
  const bePct = Math.max(0, Math.min(100, (breakEvenTH / summit) * 100));
  const inHole = drawOwed > 0;
  const gapToGoal = Math.max(0, summit - takeHome);
  const hit = takeHome >= summit;

  // Milestone checkpoints along the climb.
  const marks = hasGoal
    ? [
        { at: bePct, label: "Break even" },
        { at: 50, label: short(summit * 0.5) },
        { at: 75, label: short(summit * 0.75) },
      ]
        // Keep on-card, AND drop any milestone sitting under the you-are-here
        // marker — its label owns that spot (July 23: "Break even" and "you're
        // here" were printing on top of each other).
        .filter((m) => m.at > 6 && m.at < 94 && Math.abs(m.at - pct) > 9)
    : [];

  return (
    <button
      onClick={onAsk}
      className="rise block w-full overflow-hidden rounded-[26px] p-6 text-left"
      style={{
        background:
          "linear-gradient(155deg, rgb(var(--accent) / 0.16), rgb(var(--line) / 0.12) 42%, rgb(var(--accent-2) / 0.06) 70%, rgb(var(--ink-900)) 100%)",
        border: "1px solid rgb(var(--accent) / 0.18)",
        boxShadow: "0 1px 2px rgb(var(--fg) / 0.04), 0 26px 48px -30px rgb(var(--accent) / 0.55)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-extrabold uppercase tracking-[0.12em] text-accent">
          <Mountain size={15} /> The climb
        </div>
        <div className="rounded-full bg-accent/12 px-2.5 py-1 text-[12px] font-extrabold tracking-wide text-accent">
          {hasGoal ? `${short(summit)} GOAL` : "SET A GOAL"}
        </div>
      </div>

      {/* BIG number — where you are */}
      <div className="mt-3 flex items-end gap-3">
        <div className="text-[56px] font-black leading-[0.9] tracking-tight tabnum">
          <CountUp value={takeHome} format={money} />
        </div>
        <div className="mb-2 text-[15px] font-bold text-fg/55 tabnum">
          {hasGoal ? `of ${money(summit)} · ${Math.round(pct)}% up` : `${Math.round(pct)}% out of the draw`}
        </div>
      </div>

      {/* Bold ascending climb ramp */}
      <div className="relative mt-5 h-[168px] w-full">
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="climbFill" x1="0" y1="1" x2="1" y2="0">
              {/* amber "in the draw" band only when there IS a draw — a
                  goal-only climb used to paint a phantom 2% band at the base */}
              {draw > 0 && <stop offset="0" stopColor="#139AF5" />}
              {draw > 0 && <stop offset={`${Math.max(2, bePct)}%`} stopColor="#139AF5" />}
              <stop offset={`${draw > 0 ? Math.min(98, bePct + 6) : 0}%`} stopColor="#26B8FA" />
              <stop offset="100%" stopColor="#31EBC7" />
            </linearGradient>
            <clipPath id="climbClip">
              <polygon points="0,60 100,0 100,7 0,67" />
            </clipPath>
          </defs>
          {/* faint full ramp */}
          <polygon points="0,60 100,0 100,7 0,67" fill="currentColor" className="text-fg/10" />
          {/* filled portion up to current progress */}
          <g clipPath="url(#climbClip)">
            <rect x="0" y="0" width={pct} height="67" fill="url(#climbFill)" />
          </g>
        </svg>

        {/* milestone stops — label anchored to the dot and edge-aware so it
            never runs off the card at the bottom-left or into the flag up top. */}
        {marks.map((m, i) => (
          <div key={i} className="absolute -translate-x-1/2 translate-y-1/2" style={{ left: `${m.at}%`, bottom: `${m.at}%` }}>
            <div className="h-2.5 w-2.5 rounded-full bg-white shadow ring-2 ring-fg/25" />
            <div className="absolute left-1/2 top-full mt-1 whitespace-nowrap text-[10px] font-bold text-fg/50" style={{ transform: `translateX(${labelShift(m.at)})` }}>{m.label}</div>
          </div>
        ))}

        {/* you-are-here marker — the label floats below the dot and shifts to
            stay on-card: reads rightward near the bottom-left start (where it
            was getting clipped), leftward near the summit, centered between. */}
        <div className="absolute z-10 -translate-x-1/2 translate-y-1/2" style={{ left: `${pct}%`, bottom: `${pct}%` }}>
          <span className="relative flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-50" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-accent ring-[3px] ring-white shadow" />
          </span>
          <div className="absolute left-1/2 top-full mt-1.5 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm" style={{ transform: `translateX(${labelShift(pct)})` }}>You&apos;re here</div>
        </div>

        {/* summit flag with the goal */}
        <div className="absolute right-0 top-0 flex -translate-y-1.5 translate-x-1.5 flex-col items-center">
          <div className={`grid h-9 w-9 place-items-center rounded-xl shadow ${hit ? "bg-good text-white" : "bg-accent text-white"}`}>
            <Flag size={17} />
          </div>
          <div className="mt-1 text-[11px] font-black text-fg/70 tabnum">{short(summit)}</div>
        </div>
      </div>

      {/* bold next-move line */}
      <div className="mt-4 flex items-center justify-between">
        {inHole ? (
          <span className="inline-flex items-center gap-1.5 text-[14px] font-extrabold text-accent">
            <Flag size={15} /> Break-even next: {money(drawOwed)}
          </span>
        ) : hit ? (
          // draw-only mode has no goal summit — "cleared the draw" is the win
          <span className="text-[14px] font-extrabold text-good">{hasGoal ? `Summit reached — ${money(takeHome)} take-home` : `Draw cleared — ${money(takeHome)} take-home and climbing`}</span>
        ) : (
          <span className="text-[14px] font-extrabold text-fg/80">Keep climbing</span>
        )}
        {!hit && <span className="text-[14px] font-bold text-fg/55 tabnum">{money(gapToGoal)} to your goal</span>}
      </div>
    </button>
  );
}
