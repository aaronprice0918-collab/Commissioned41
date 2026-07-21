"use client";

import { useId } from "react";

// EILA's clean command core — the same glossy steel-orb family as the Mission OS
// Lite core (one design language across the ecosystem), but unmistakably HER:
// an aware living lens. A bright aperture/iris ring, a hot white nucleus that
// pulses like she's awake and watching, and a faster sensor sweep give EILA more
// "alive" energy than Lite's calm progress core — without the photoreal eye,
// which read as "too much." Pure CSS, self-contained, reduced-motion safe.
export function IlaCore({
  className = "",
  intensity = 0.7,
}: {
  className?: string;
  intensity?: number;
}) {
  const uid = useId().replace(/[:]/g, "");
  const lvl = Math.min(Math.max(intensity, 0), 1);
  const speed = 1 - lvl * 0.35;

  return (
    <div
      className={`ila-wrap ${className}`}
      aria-hidden
      style={{ position: "relative", isolation: "isolate" }}
    >
      <style>{`
        .ila-wrap{display:block}
        .ila-corona-${uid}{position:absolute;inset:-18%;border-radius:50%;
          background:radial-gradient(circle at 50% 50%,rgba(110,160,255,.38),rgba(130,180,255,.13) 46%,rgba(4,6,12,0) 70%);
          filter:blur(8px);animation:ilaCorona ${5.2 * speed}s ease-in-out infinite}
        /* glossy orb body — same family as the Lite core */
        .ila-orb-${uid}{position:absolute;inset:0;border-radius:50%;
          background:radial-gradient(circle at 50% 38%,#eef4ff 0%,#a6c8ff 15%,#4a7cf0 38%,#15203c 72%,#080d1a 100%);
          box-shadow:
            inset 0 0 18px 4px rgba(0,0,0,.52),
            inset 0 6px 14px rgba(255,255,255,.3),
            0 0 0 1px rgba(160,190,240,.2),
            0 10px 30px rgba(0,0,0,.45),
            0 0 30px rgba(110,160,255,.42);
          animation:ilaBreathe ${5.6 * speed}s ease-in-out infinite}
        .ila-gloss-${uid}{position:absolute;inset:0;border-radius:50%;pointer-events:none;
          background:radial-gradient(58% 40% at 50% 23%,rgba(255,255,255,.55),rgba(255,255,255,0) 60%);
          mix-blend-mode:screen}
        /* EILA's living lens — a bright iris ring (her signature) */
        .ila-iris-${uid}{position:absolute;inset:24%;border-radius:50%;pointer-events:none;
          background:conic-gradient(from 90deg,rgba(150,195,255,.25),rgba(220,235,255,.85),rgba(150,195,255,.25),rgba(220,235,255,.85),rgba(150,195,255,.25));
          -webkit-mask:radial-gradient(closest-side,transparent 70%,#000 72%,#000 100%);
          mask:radial-gradient(closest-side,transparent 70%,#000 72%,#000 100%);
          filter:drop-shadow(0 0 4px rgba(170,210,255,.6));
          animation:ilaSpin ${9 * speed}s linear infinite}
        /* hot, awake nucleus — pulses faster + brighter than Lite */
        .ila-core-${uid}{position:absolute;inset:38%;border-radius:50%;pointer-events:none;mix-blend-mode:screen;
          background:radial-gradient(circle at 50% 46%,#ffffff 0%,rgba(200,225,255,.7) 34%,rgba(110,160,255,0) 72%);
          animation:ilaPulse ${2.3 * speed}s ease-in-out infinite}
        /* active sensor sweep — quicker than Lite (she's scanning) */
        .ila-scan-${uid}{position:absolute;inset:3%;border-radius:50%;pointer-events:none;mix-blend-mode:screen;opacity:.65;
          background:conic-gradient(from 0deg,rgba(160,200,255,0) 0deg,rgba(195,222,255,.6) 22deg,rgba(160,200,255,0) 58deg,rgba(160,200,255,0) 360deg);
          -webkit-mask:radial-gradient(closest-side,transparent 78%,#000 79%);
          mask:radial-gradient(closest-side,transparent 78%,#000 79%);
          animation:ilaSpin ${5 * speed}s linear infinite}
        /* thin rim ring */
        .ila-ring-${uid}{position:absolute;inset:-2%;border-radius:50%;pointer-events:none;
          background:conic-gradient(from 160deg,rgba(130,185,255,0) 0deg,rgba(150,200,255,.9) 64deg,#ffffff 92deg,rgba(130,185,255,0) 150deg,rgba(130,185,255,0) 360deg);
          -webkit-mask:radial-gradient(closest-side,transparent 92%,#000 93%);
          mask:radial-gradient(closest-side,transparent 92%,#000 93%);
          filter:drop-shadow(0 0 5px rgba(150,200,255,.7));
          animation:ilaSpin ${13 * speed}s linear infinite reverse}
        @keyframes ilaBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.025)}}
        @keyframes ilaCorona{0%,100%{transform:scale(.96);opacity:.74}50%{transform:scale(1.06);opacity:1}}
        @keyframes ilaPulse{0%,100%{opacity:.55;transform:scale(.9)}50%{opacity:1;transform:scale(1.08)}}
        @keyframes ilaSpin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion:reduce){
          .ila-corona-${uid},.ila-orb-${uid},.ila-iris-${uid},.ila-core-${uid},.ila-scan-${uid},.ila-ring-${uid}{animation:none}
        }
      `}</style>

      <div className={`ila-corona-${uid}`} />
      <div className={`ila-orb-${uid}`} />
      <div className={`ila-gloss-${uid}`} />
      <div className={`ila-iris-${uid}`} />
      <div className={`ila-scan-${uid}`} />
      <div className={`ila-core-${uid}`} />
      <div className={`ila-ring-${uid}`} />
    </div>
  );
}
