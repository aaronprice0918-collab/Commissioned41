"use client";

import { useRef, useState } from "react";
import Image from "next/image";

// The freed C41 mark — floats on the page (no black box), wrapped in a soft
// glow, with a gentle pointer-driven 3D tilt + a moving specular sheen so the
// metal feels alive and dimensional. Honors prefers-reduced-motion (tilt off).
export function C41Logo({
  src = "/brand/c41-logo-transparent.png",
  width = 1007,
  height = 755,
  alt = "Commissioned 41",
  className = "",
  priority = false,
  maxTilt = 9,
}: {
  src?: string;
  width?: number;
  height?: number;
  alt?: string;
  className?: string;
  priority?: boolean;
  maxTilt?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState({ rx: 0, ry: 0, mx: 50, active: false });

  function onMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width; // 0..1
    const py = (e.clientY - r.top) / r.height;
    setT({
      ry: (px - 0.5) * maxTilt * 2,
      rx: -(py - 0.5) * maxTilt * 2,
      mx: px * 100,
      active: true,
    });
  }
  function reset() {
    setT({ rx: 0, ry: 0, mx: 50, active: false });
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={`group relative mx-auto ${className}`}
      style={{ perspective: "1000px" }}
    >
      {/* glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[78%] w-[88%] -translate-x-1/2 -translate-y-1/2 rounded-[40%] bg-mission-green/15 blur-[90px]"
      />
      <div
        className="relative transition-transform duration-300 ease-out will-change-transform"
        style={{
          transform: `rotateX(${t.rx}deg) rotateY(${t.ry}deg) ${t.active ? "scale(1.015)" : ""}`,
          transformStyle: "preserve-3d",
        }}
      >
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          className="chrome-art h-auto w-full select-none"
        />
        {/* moving specular sheen */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(40% 60% at ${t.mx}% 30%, rgba(255,255,255,0.22), transparent 70%)`,
          }}
        />
      </div>
    </div>
  );
}
