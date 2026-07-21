"use client";

import { useId } from "react";

// EILA's mark — the app icon itself: an ice-white rounded-square (squircle)
// carrying the big blue E, exactly like public/brand/eila-app-icon.svg. Kept
// alive with a breathing scale and a soft blue halo; no extra rings or discs
// fighting the tile's shape.
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
        .ila-halo-${uid}{position:absolute;inset:-16%;border-radius:38%;
          background:radial-gradient(circle at 50% 50%,rgba(84,140,255,.30),rgba(84,140,255,.08) 55%,rgba(84,140,255,0) 74%);
          filter:blur(7px);animation:ilaHalo ${5.4 * speed}s ease-in-out infinite}
        .ila-tile-${uid}{position:absolute;inset:0;display:grid;place-items:center;border-radius:27%;
          background:#F1F5FF;
          box-shadow:inset 0 1.5px 0 rgba(255,255,255,.95),inset 0 -5px 10px rgba(88,132,220,.14),
            0 0 0 1px rgba(20,34,66,.35),0 10px 24px rgba(6,14,34,.35);
          animation:ilaBreathe ${5.6 * speed}s ease-in-out infinite}
        .ila-letter-${uid}{display:block;width:66%;height:66%}
        @keyframes ilaBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
        @keyframes ilaHalo{0%,100%{transform:scale(.96);opacity:.6}50%{transform:scale(1.08);opacity:1}}
        @media (prefers-reduced-motion:reduce){
          .ila-halo-${uid},.ila-tile-${uid}{animation:none}
        }
      `}</style>

      <div className={`ila-halo-${uid}`} />
      <div className={`ila-tile-${uid}`}>
        {/* Same geometry as eila-app-icon.svg, scaled to a 48 viewBox. */}
        <svg className={`ila-letter-${uid}`} viewBox="0 0 48 48" fill="none" aria-hidden>
          <rect x="11.4" y="6.5" width="7.47" height="35" rx="1.6" fill="#3567D6" />
          <rect x="11.4" y="6.5" width="25.2" height="7.47" rx="1.6" fill="#3567D6" />
          <rect x="11.4" y="20.73" width="21" height="6.53" rx="1.4" fill="#3567D6" />
          <rect x="11.4" y="34.03" width="25.2" height="7.47" rx="1.6" fill="#3567D6" />
        </svg>
      </div>
    </div>
  );
}
