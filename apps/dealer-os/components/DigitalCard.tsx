/* eslint-disable @next/next/no-img-element */
"use client";

import { Mail, MessageSquare, Phone, ShieldCheck, UserPlus } from "lucide-react";
import { vCardFileName, vCardHref } from "@/lib/vcard";

// The digital business card a customer sees when they scan/open the link. Its
// own self-contained look (never theme-dependent — it renders outside the app):
// a deep-blue brand header, a big photo breaking the seam, the name, and the
// four things a card is FOR — call, text, email, and save-to-contacts (vCard).
export type DigitalCardData = {
  name: string;
  displayName: string;
  title: string;
  org: string;
  phone?: string;
  email?: string;
  employeeNumber?: string;
  publicUrl?: string;
  photoSrc: string; // the photo/logo URL — the card owns the framing so nothing clips
  photoContain?: boolean; // true for logos/artwork: fit the whole image inside the circle
};

export function DigitalCard({ data }: { data: DigitalCardData }) {
  const telHref = data.phone ? `tel:${data.phone.replace(/[^0-9+]/g, "")}` : undefined;
  const smsHref = data.phone ? `sms:${data.phone.replace(/[^0-9+]/g, "")}` : undefined;
  const vcf = vCardHref({ name: data.displayName, title: data.title, org: data.org, phone: data.phone, email: data.email, url: data.publicUrl });

  return (
    // The card is ALWAYS white — it renders outside the app for a customer.
    // Reset --c41-white to true white so the Sky theme's white→ink flip (which
    // recolors in-app chrome) never touches this surface.
    <div
      style={{ ["--c41-white" as string]: "255 255 255" }}
      className="mx-auto w-full max-w-sm overflow-hidden rounded-[28px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_40px_90px_-30px_rgba(23,52,120,0.45)] ring-1 ring-slate-900/5"
    >
      {/* Brand header — deep automotive blue, subtle sheen */}
      <div className="relative h-32 overflow-hidden bg-gradient-to-br from-[#123a86] via-[#1f5bd0] to-[#2f6ae0]">
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "radial-gradient(120% 100% at 20% -20%, rgba(255,255,255,0.35), transparent 55%)" }} />
        {/* Kennesaw mountain peaks — the dealership mark's ridgeline as a
            watermark across the band (paths from brand/kennesaw-mazda-mark.svg) */}
        <svg
          viewBox="100 20 440 130"
          className="pointer-events-none absolute inset-x-0 bottom-[-6px] mx-auto h-[105%] w-[88%] opacity-[0.16]"
          fill="none"
          stroke="#ffffff"
          strokeLinecap="square"
          strokeMiterlimit={10}
          aria-hidden
        >
          <path d="M112 126 214 42l116 95" strokeWidth={24} />
          <path d="M296 126 430 28l100 110" strokeWidth={24} />
          <path d="M210 144 246 104" strokeWidth={18} opacity={0.7} />
          <path d="M434 144 390 90" strokeWidth={18} opacity={0.7} />
        </svg>
        <div className="absolute left-6 top-5 text-[11px] font-black uppercase tracking-[0.22em] text-white/85">{data.org}</div>
        <div className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-white/18 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white ring-1 ring-white/30 backdrop-blur">
          <ShieldCheck className="h-3 w-3" /> Verified
        </div>
      </div>

      <div className="px-6 pb-7">
        {/* Photo breaks the header seam */}
        {/* relative z-10: the header above is position:relative (for its badge),
            so a static photo would paint UNDER it and lose its top half. */}
        <div className="relative z-10 -mt-14 mb-4 flex justify-center">
          <div className="h-28 w-28 overflow-hidden rounded-full bg-white p-[4px] shadow-[0_12px_30px_-12px_rgba(23,52,120,0.6)] ring-1 ring-slate-900/5">
            <div className="h-full w-full overflow-hidden rounded-full bg-white">
              <img
                src={data.photoSrc}
                alt={data.displayName}
                className={`h-full w-full object-center ${data.photoContain ? "object-contain p-1.5" : "object-cover"}`}
              />
            </div>
          </div>
        </div>

        <h1 className="font-display text-[26px] font-black leading-tight tracking-tight text-slate-900">{data.displayName}</h1>
        <div className="mt-0.5 text-sm font-semibold text-[#1f5bd0]">{data.title}</div>
        <div className="mt-0.5 text-sm text-slate-500">{data.org}</div>

        {/* Tap-to-contact rows */}
        <div className="mt-5 space-y-2">
          {data.phone && (
            <a href={telHref} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-slate-800 ring-1 ring-slate-900/5 transition active:scale-[0.99]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1f5bd0]/10 text-[#1f5bd0]"><Phone className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Mobile</span><span className="block truncate text-[15px] font-semibold tabular-nums">{data.phone}</span></span>
            </a>
          )}
          {data.email && (
            <a href={`mailto:${data.email}`} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-slate-800 ring-1 ring-slate-900/5 transition active:scale-[0.99]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1f5bd0]/10 text-[#1f5bd0]"><Mail className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Email</span><span className="block truncate text-[15px] font-semibold">{data.email}</span></span>
            </a>
          )}
        </div>

        {/* Primary actions */}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {telHref && (
            <a href={telHref} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#1f5bd0] px-5 py-3.5 text-sm font-black uppercase tracking-[0.1em] text-white shadow-[0_12px_28px_-10px_rgba(31,91,208,0.7)] transition active:scale-[0.99]">
              <Phone className="h-4 w-4" /> Call Now
            </a>
          )}
          {smsHref && (
            <a href={smsHref} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 ring-1 ring-slate-900/5 transition active:scale-[0.99]">
              <MessageSquare className="h-4 w-4" /> Text
            </a>
          )}
          <a
            href={vcf}
            download={vCardFileName(data.displayName)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition active:scale-[0.99]"
          >
            <UserPlus className="h-4 w-4" /> Save
          </a>
        </div>

        <div className="mt-5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">
          <span>{data.employeeNumber ? `Employee #${data.employeeNumber}` : "Kennesaw Mazda"}</span>
          <span>Powered by Dealer Mission OS</span>
        </div>
      </div>
    </div>
  );
}
