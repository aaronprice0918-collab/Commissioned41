"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import {
  CONSENT_CHANNELS,
  CONSENT_GRANT_SOURCES,
  CONSENT_REVOKE_SOURCES,
  consentStatus,
  type ConsentChannel,
  type ConsentEvent,
} from "@/lib/consent";

// The consent rail on a lead card: one chip per channel (Call / Text / Email).
// Green = express consent on file, neutral = nothing recorded, red = REVOKED
// (do not contact). Tapping a chip opens the capture menu — every tap writes
// an audit event with a source, because consent without a source is worthless
// in a TCPA dispute. `by` stamps who recorded it.
export function ConsentChips({
  lead,
  by,
  onRecord,
}: {
  lead: { consent?: { events: ConsentEvent[] } };
  by?: string;
  onRecord: (event: ConsentEvent) => void;
}) {
  const [open, setOpen] = useState<ConsentChannel | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const record = (channel: ConsentChannel | "all", action: "granted" | "revoked", source: string) => {
    onRecord({ channel, action, at: new Date().toISOString(), source, ...(by ? { by } : {}) });
    setOpen(null);
  };

  return (
    <div ref={rootRef} className="relative inline-flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] font-black uppercase tracking-[0.14em] text-white/40">Consent</span>
      {CONSENT_CHANNELS.map(({ key, label }) => {
        const state = consentStatus(lead, key);
        const tone =
          state === "granted"
            ? "border-mission-green/50 bg-mission-green/10 text-mission-green"
            : state === "revoked"
              ? "border-mission-red/60 bg-mission-red/15 text-mission-red"
              : "border-white/15 bg-white/[0.03] text-white/45";
        return (
          <button
            key={key}
            type="button"
            onClick={() => setOpen(open === key ? null : key)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] transition hover:brightness-125 ${tone}`}
            title={state === "revoked" ? `${label}: REVOKED — do not contact` : state === "granted" ? `${label}: consent on file` : `${label}: nothing recorded — tap to capture`}
          >
            {state === "revoked" ? <ShieldOff className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
            {label}
          </button>
        );
      })}
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-64 rounded-[12px] border border-white/12 bg-[#14161c] p-3 shadow-2xl">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-mission-green">Customer opted in — how?</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CONSENT_GRANT_SOURCES.map((source) => (
              <button key={source} type="button" onClick={() => record(open, "granted", source)} className="rounded-full border border-mission-green/40 px-2 py-1 text-[10px] font-bold text-mission-green transition hover:bg-mission-green hover:text-mission-navy">
                {source}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[10px] font-black uppercase tracking-[0.14em] text-mission-red">Customer revoked — how?</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CONSENT_REVOKE_SOURCES.map((source) => (
              <button key={source} type="button" onClick={() => record(open, "revoked", source)} className="rounded-full border border-mission-red/40 px-2 py-1 text-[10px] font-bold text-mission-red transition hover:bg-mission-red hover:text-white">
                {source}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => record("all", "revoked", "Do-not-call request")} className="mt-3 w-full rounded-full bg-mission-red px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-white transition hover:brightness-110">
            <ShieldOff className="mr-1 inline h-3 w-3" /> Stop ALL contact (DNC)
          </button>
        </div>
      )}
    </div>
  );
}
