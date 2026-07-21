"use client";

import { useId } from "react";

// EILA's living core — her eye. The photoreal robotic iris
// (public/brand/ila-eye.jpg) sits at the centre, brought alive with CSS:
// breathing, a powering pulse, a sensor-scan, little balls of light running her
// circuits, and a vibrant neon haze glowing around her. Everything is pure CSS
// (no SVG filters) so it renders identically on iPhone and is always centred.
// Degrades to a still, lit eye under reduced-motion.

const SRC = "/brand/ila-eye.jpg";

// The "tracers" — little balls of light running through her iris circuits. Each
// orbits the eye centre at its own radius (left %), size, speed and start phase
// (negative delay), some clockwise some counter, so they scatter everywhere and
// read as energy travelling the circuit rings.
const TRACERS: { left: number; size: number; dur: number; dir: "normal" | "reverse"; delay: number }[] = [
  { left: 67, size: 2.6, dur: 11, dir: "normal", delay: -2 },
  { left: 70, size: 3.0, dur: 8, dir: "reverse", delay: -5 },
  { left: 72, size: 2.2, dur: 14, dir: "normal", delay: -9 },
  { left: 74, size: 3.4, dur: 10, dir: "normal", delay: -1 },
  { left: 76, size: 2.8, dur: 16, dir: "reverse", delay: -7 },
  { left: 79, size: 2.4, dur: 12, dir: "normal", delay: -3 },
  { left: 68, size: 3.2, dur: 9, dir: "reverse", delay: -6 },
  { left: 71, size: 2.0, dur: 7, dir: "normal", delay: -4 },
  { left: 73, size: 3.6, dur: 18, dir: "reverse", delay: -11 },
  { left: 69, size: 2.6, dur: 13, dir: "normal", delay: -8 },
  { left: 80, size: 2.2, dur: 15, dir: "normal", delay: -2 },
  { left: 66, size: 2.4, dur: 10, dir: "reverse", delay: -5 },
  { left: 77, size: 3.0, dur: 20, dir: "normal", delay: -13 },
  { left: 75, size: 2.0, dur: 6, dir: "reverse", delay: -3 },
];

export function IlaLivingCore({ className = "", intensity = 0.6, portal = false }: { className?: string; intensity?: number; portal?: boolean }) {
  const uid = useId().replace(/[:]/g, "");
  const lvl = Math.min(Math.max(intensity, 0), 1);
  const speed = 1 - lvl * 0.35; // higher intensity → livelier

  return (
    <div className={`ilc-wrap ${className}`} aria-hidden style={{ position: "relative", isolation: "isolate" }}>
      <style>{`
        .ilc-wrap{display:block}
        .ilc-corona-${uid}{position:absolute;inset:-16%;border-radius:50%;
          background:radial-gradient(circle at 50% 50%,rgba(96,146,255,.32),rgba(120,170,255,.12) 44%,rgba(4,6,12,0) 70%);
          filter:blur(8px);animation:ilcCorona ${5.4 * speed}s ease-in-out infinite}
        .ilc-eye-${uid}{position:absolute;inset:${portal ? "10%" : "0"};border-radius:50%;
          background:url(${SRC}) center/cover no-repeat;
          box-shadow:inset 0 0 16px 3px rgba(0,0,0,.55),0 0 0 1px rgba(130,160,210,.14),0 8px 28px rgba(0,0,0,.45);
          animation:ilcBreathe ${6 * speed}s ease-in-out infinite}
        .ilc-pulse-${uid}{position:absolute;inset:${portal ? "10%" : "0"};border-radius:50%;mix-blend-mode:screen;pointer-events:none;
          background:radial-gradient(circle at 50% 50%,rgba(255,232,202,.5),rgba(120,172,255,.20) 15%,rgba(0,0,0,0) 33%);
          animation:ilcPulse ${2.8 * speed}s ease-in-out infinite}
        .ilc-scan-${uid}{position:absolute;inset:${portal ? "10%" : "0"};border-radius:50%;mix-blend-mode:screen;pointer-events:none;opacity:.55;
          background:conic-gradient(from 0deg,rgba(120,172,255,0) 0deg,rgba(160,205,255,.20) 22deg,rgba(120,172,255,0) 58deg,rgba(120,172,255,0) 360deg);
          animation:ilcSpin ${7.5 * speed}s linear infinite}
        ${portal ? `
        /* The living neon haze — a vibrant electric halo around her iris that
           breathes and slowly drifts its hue (cyan ↔ electric blue). Pure CSS,
           perfectly centred, soft-faded so it has no hard edge — reads as glowing
           energy hovering over her, never a clumpy off-centre blob. */
        .ilc-haze-${uid}{position:absolute;inset:-16%;border-radius:50%;mix-blend-mode:screen;pointer-events:none;
          background:radial-gradient(circle at 50% 50%,rgba(0,0,0,0) 43%,rgba(40,210,255,.7) 60%,rgba(90,150,255,.5) 74%,rgba(0,0,0,0) 95%);
          animation:ilcHazePulse ${3.6 * speed}s ease-in-out infinite,ilcHazeHue ${15 * speed}s ease-in-out infinite}
        /* Her iris is ALIVE: little balls of light running through the circuits,
           orbiting at many radii. The mask keeps every tracer in the iris circuit
           band — fully transparent over the pupil so a spark can NEVER cross the
           dark centre. */
        .ilc-circuit-${uid}{position:absolute;inset:10%;border-radius:50%;overflow:hidden;mix-blend-mode:screen;pointer-events:none;
          -webkit-mask:radial-gradient(circle at 50% 50%,transparent 31%,#000 42%);
                  mask:radial-gradient(circle at 50% 50%,transparent 31%,#000 42%)}
        .ilc-tr-${uid}{position:absolute;inset:0;transform-origin:50% 50%;animation-name:ilcSpin;animation-timing-function:linear;animation-iteration-count:infinite}
        .ilc-tr-${uid} i{position:absolute;top:50%;display:block;border-radius:50%;transform:translate(-50%,-50%);
          background:radial-gradient(circle,#ffffff 0%,#bfe0ff 38%,rgba(130,185,255,0) 70%);
          box-shadow:0 0 7px 2px rgba(190,220,255,.95),0 0 16px 6px rgba(120,175,255,.5)}
        ` : ""}
        @keyframes ilcBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.022)}}
        @keyframes ilcCorona{0%,100%{transform:scale(.96);opacity:.7}50%{transform:scale(1.05);opacity:1}}
        @keyframes ilcPulse{0%,100%{opacity:.28;transform:scale(.9)}50%{opacity:.85;transform:scale(1.06)}}
        @keyframes ilcHazePulse{0%,100%{opacity:.5;transform:scale(.99)}50%{opacity:.95;transform:scale(1.05)}}
        @keyframes ilcHazeHue{0%,100%{filter:blur(9px) saturate(1.8) hue-rotate(-10deg)}50%{filter:blur(11px) saturate(2) hue-rotate(60deg)}}
        @keyframes ilcSpin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion:reduce){
          .ilc-corona-${uid},.ilc-eye-${uid},.ilc-pulse-${uid},.ilc-scan-${uid},.ilc-tr-${uid},.ilc-haze-${uid}{animation:none}
        }
      `}</style>

      <div className={`ilc-corona-${uid}`} />
      {portal && <div className={`ilc-haze-${uid}`} />}
      <div className={`ilc-eye-${uid}`} />
      <div className={`ilc-pulse-${uid}`} />
      <div className={`ilc-scan-${uid}`} />
      {portal && (
        <div className={`ilc-circuit-${uid}`}>
          {TRACERS.map((t, i) => (
            <span key={i} className={`ilc-tr-${uid}`}
              style={{ animationDuration: `${t.dur * speed}s`, animationDirection: t.dir, animationDelay: `${t.delay}s` }}>
              <i style={{ left: `${t.left}%`, width: `${t.size}px`, height: `${t.size}px` }} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
