"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import clsx from "clsx";
import { NavMark } from "@/components/Wordmark";
import { NAV_LINKS } from "@/config/site";

// Shared sticky top navigation for the whole brand site. The monogram chip is
// the home link; the right-side links carry an active state. Collapses to a
// glass sheet on mobile.
export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // When the mobile sheet is open: focus the first link, trap Tab within the
  // sheet, close on Escape, and return focus to the toggle on close.
  useEffect(() => {
    if (!open) return;

    const sheet = sheetRef.current;
    const focusables = sheet?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusables?.[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-[rgba(240,244,251,0.86)] shadow-[0_12px_34px_-30px_rgba(15,23,42,0.38)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-shell items-center justify-between px-5 py-3 sm:px-8">
        <Link href="/" aria-label="Commissioned 41 — home" className="glass rounded-full px-3.5 py-2">
          <NavMark />
        </Link>

        {/* desktop links */}
        <nav className="hidden items-center gap-8 text-sm md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                "transition-colors",
                isActive(l.href) ? "text-white" : "text-white/55 hover:text-white"
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <Link href="/products" className="btn btn-ghost !hidden !px-5 !py-2.5 text-sm md:!inline-flex">
          Explore Systems
        </Link>

        {/* mobile toggle */}
        <button
          ref={toggleRef}
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav-sheet"
          onClick={() => setOpen((v) => !v)}
          className="glass grid h-10 w-10 place-items-center rounded-full text-white/80 md:hidden"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* mobile sheet */}
      {open && (
        <div
          ref={sheetRef}
          id="mobile-nav-sheet"
          className="mx-auto max-w-shell px-5 pb-4 md:hidden"
        >
          <div className="glass living-border flex flex-col gap-1 p-3">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  "rounded-xl px-4 py-3 text-[15px] transition-colors",
                  isActive(l.href)
                    ? "bg-mission-green/10 text-white"
                    : "text-white/65 hover:bg-white/[0.04] hover:text-white"
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
