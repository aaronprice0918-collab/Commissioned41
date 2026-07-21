"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";

// Makes a glass pane feel physical: it tilts in 3D toward the pointer and the
// specular highlight (--mx/--my) follows your touch, like a real sheet of glass
// you could pick up. Springs back when you let go. Disabled under reduced motion.
export function Tilt({
  children,
  className,
  style,
  max = 7,
  lift = 8,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  max?: number;
  lift?: number;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || reduced) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1000px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateZ(${lift}px)`;
    el.style.setProperty("--mx", `${(px * 100 + 50).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100 + 50).toFixed(1)}%`);
  }

  function reset() {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0)";
    el.style.removeProperty("--mx");
    el.style.removeProperty("--my");
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={className}
      style={{ ...style, ...(onClick ? { cursor: "pointer" } : null) }}
    >
      {children}
    </div>
  );
}
