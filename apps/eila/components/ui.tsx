"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown, X } from "lucide-react";

// Shared numeric-input parser — three components each grew their own copy of
// this (audit finding, July 5), and one of them (PlanEditor's) had silently
// drifted to a stricter regex that strips minus signs. Consolidated here so a
// future signed-amount field (e.g. making deductions editable) doesn't
// inherit whichever copy happens to be nearby.
export function parseNumericInput(s: string): number {
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

// A numeric input that lets the user TYPE like a human — "22.5", "0.5", a
// trailing dot mid-keystroke — while the parent only ever sees a number. The
// naive controlled pattern (value={String(n)}, onChange={parse}) round-trips
// through parseFloat on every keystroke, so a typed "." vanished instantly:
// "22." re-rendered as "22" and the next key made it 225 — a 10×-wrong
// commission percent saved into a pay plan (July 8 audit, HIGH). Local text
// state absorbs in-progress keystrokes; the parsed number propagates on every
// change; blur — or an OUTSIDE change to `value` (a plan re-parse, an EILA
// tool) — re-normalizes the text.
export function NumInput({ value, onChange, className, placeholder = "0", ...rest }: {
  value: number; onChange: (n: number) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState(() => (value ? String(value) : ""));
  const lastParsed = useRef(value);
  if (value !== lastParsed.current) {
    // The prop moved without us (external write) — adopt it. Our own echo
    // (value === what we last parsed) leaves the raw text alone mid-type.
    lastParsed.current = value;
    if (parseNumericInput(text) !== value) setText(value ? String(value) : "");
  }
  return (
    <input
      {...rest}
      className={className}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNumericInput(e.target.value);
        lastParsed.current = n;
        onChange(n);
      }}
      onBlur={(e) => { setText(value ? String(value) : ""); rest.onBlur?.(e); }}
    />
  );
}

export function Stat({ label, value, hint, accent, onClick }: { label: string; value: string; hint?: string; accent?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-fg/65">{label}</div>
      <div className={clsx("mt-1 text-2xl font-black tabnum leading-none", accent ? "text-accent" : "text-fg")}>{value}</div>
      {hint && <div className="mt-1.5 text-xs text-fg/70">{hint}</div>}
    </>
  );
  // Tappable when a handler is given — a number you can question (tap → EILA
  // explains it) instead of a number you have to trust.
  if (onClick) return <button className="glass block w-full p-4 text-left active:scale-[0.99]" onClick={onClick}>{body}</button>;
  return <div className="glass p-4">{body}</div>;
}

export function Bar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="track" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${w}%` }} />
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center justify-between px-1">
      <h2 className="flex min-w-0 items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-fg/65">
        <span className="h-3 w-1.5 shrink-0 rounded-full bg-accent2" />
        <span className="min-w-0 truncate">{children}</span>
      </h2>
      {action}
    </div>
  );
}

// A quiet drop-down for the granular, look-it-up-when-you-want data — the
// stuff Aaron wants OFF the bold screens ("boring data that you find in a drop
// down"). Native <details> so it's zero-JS, keyboard-friendly, and collapsed by
// default. The summary is a clean glass row; the chevron flips when it opens.
export function Drawer({ label, hint, children, defaultOpen }: { label: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="drawer mt-3 group" open={defaultOpen}>
      <summary className="glass flex cursor-pointer list-none items-center justify-between p-4 active:scale-[0.99]">
        <span className="min-w-0">
          <span className="block text-[13px] font-bold uppercase tracking-[0.14em] text-fg/70">{label}</span>
          {hint && <span className="mt-0.5 block truncate text-xs font-normal normal-case tracking-normal text-fg/55">{hint}</span>}
        </span>
        <ChevronDown size={20} className="shrink-0 text-fg/45 transition-transform duration-300 group-open:rotate-180" />
      </summary>
      <div className="drawer-body space-y-1 pt-1">{children}</div>
    </details>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet-backdrop absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="sheet-panel glass relative z-10 max-h-[92vh] w-full max-w-app overflow-y-auto rounded-b-none rounded-t-[26px] p-5 pb-8 sm:max-w-xl sm:rounded-[26px] sm:pb-5 lg:max-w-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold tracking-tight">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full bg-fg/8 text-fg/70 active:scale-95">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-xs font-semibold uppercase tracking-wider text-fg/70">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block px-1 text-xs text-fg/60">{hint}</span>}
    </label>
  );
}
