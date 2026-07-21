"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#why", label: "Why Dealer Mission OS" },
  { href: "#pricing", label: "Pricing" },
  { href: "#about", label: "About" },
];

// Mobile-only nav for the landing page: a hamburger that opens the section links
// plus the Get a Demo CTA. Sign In stays visible in the header itself.
export function LandingMobileMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full border border-white/15 text-white/85 transition hover:text-white"
      >
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {open && (
        <>
          <button type="button" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 top-[56px] z-40 cursor-default bg-black/50" />
          <div className="absolute left-0 right-0 top-full z-50 border-b border-white/10 bg-[#0b0c10] shadow-[0_24px_60px_rgba(0,0,0,0.65)]">
            <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-[10px] px-3 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/5 hover:text-white"
                >
                  {l.label}
                </a>
              ))}
              <a
                href="#join"
                onClick={() => setOpen(false)}
                className="mt-1 rounded-full bg-mission-gold px-4 py-3 text-center text-xs font-black uppercase tracking-[0.1em] text-mission-navy transition hover:brightness-110"
              >
                Get a Demo
              </a>
            </nav>
          </div>
        </>
      )}
    </div>
  );
}
