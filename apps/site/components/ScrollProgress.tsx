"use client";

import { useEffect, useState } from "react";

// A thin steel-blue bar across the very top that fills as you scroll — a quiet
// "alive" signal that the page is responding to you. Pure transform/opacity, so
// it's cheap; hidden under prefers-reduced-motion via the .scroll-progress rule.
export function ScrollProgress() {
  const [p, setP] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = document.documentElement;
        const max = h.scrollHeight - h.clientHeight;
        setP(max > 0 ? Math.min(h.scrollTop / max, 1) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div aria-hidden className="scroll-progress pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]">
      <div
        className="h-full origin-left bg-gradient-to-r from-mission-green via-mission-gold to-mission-green shadow-[0_0_12px_rgb(var(--mission-green)/0.8)]"
        style={{ transform: `scaleX(${p})`, transition: "transform 0.12s linear" }}
      />
    </div>
  );
}
