"use client";

import { Bot, LockKeyhole, MessageSquareText, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/storeClient";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { productLabels } from "@/lib/data";
import type { ProductKey, StoreSettings, StoreTargets } from "@/lib/data";

const inputClass =
  "h-11 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition focus:border-mission-gold/60";
const labelClass = "readable-text mb-2 block text-xs font-black uppercase tracking-[0.1em] text-mission-gold";

export default function StoreSettingsPage() {
  const { isAdmin, isOwner, secureMode } = useAuth();
  const { settings, updateSettings, resetSettings } = useStoreSettings();

  function setField<K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) {
    updateSettings({ ...settings, [key]: value });
  }
  function setTarget<K extends keyof StoreTargets>(key: K, value: number) {
    updateSettings({ ...settings, targets: { ...settings.targets, [key]: value } });
  }
  function setWeight(key: ProductKey, value: number) {
    updateSettings({ ...settings, productWeights: { ...settings.productWeights, [key]: value } });
  }

  // Percentages are stored as fractions (0.06) but edited as whole numbers (6).
  const num = (v: string) => Math.max(Number(v) || 0, 0);

  return (
    <div>
      <SectionHeader title="Store Settings" kicker="The numbers behind every screen" />

      {secureMode && !isAdmin && !isOwner ? (
        <div className="glass-card rounded-[12px] p-10 text-center">
          <LockKeyhole className="mx-auto h-10 w-10 text-mission-gold" />
          <div className="mt-4 font-display text-3xl font-black text-white">Admin access required.</div>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/58">
            Doc fee, tax, holdback, product weights, and store targets are restricted to Admin access.
          </p>
        </div>
      ) : (
        <>
          <section className="glass-card rounded-[12px] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-[12px] bg-mission-gold/10 text-mission-gold">
                  <SlidersHorizontal className="h-6 w-6" />
                </div>
                <div>
                  <div className="readable-text font-display text-2xl font-black text-white">Tune the numbers for this store</div>
                  <div className="readable-text text-sm leading-6 text-white/56">
                    The formulas are the same everywhere — these constants are what make the math right for{" "}
                    <span className="text-white/80">{settings.storeName}</span>. Every screen reads from here.
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={resetSettings}
                  className="inline-flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black uppercase tracking-[0.08em] text-white/70 transition hover:border-mission-gold/40 hover:text-white"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset to Default
                </button>
                <StatusPill tone="green">Auto Saved</StatusPill>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.035] p-3 text-sm font-bold text-white">
              <Save className="h-4 w-4 text-mission-gold" />
              Changes save automatically as you type.
            </div>
          </section>

          {/* Store identity + deal economics */}
          <section className="glass-card mt-5 rounded-[12px] p-5">
            <div className="readable-text mb-4 font-display text-xl font-black text-white">Store &amp; Deal Economics</div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className={labelClass}>Store Name</span>
                <input className={inputClass} type="text" value={settings.storeName} onChange={(e) => setField("storeName", e.target.value)} />
              </label>
              <label className="block">
                <span className={labelClass}>Doc Fee ($)</span>
                <input className={inputClass} type="number" min="0" value={settings.docFee} onChange={(e) => setField("docFee", num(e.target.value))} />
              </label>
              <label className="block">
                <span className={labelClass}>Holdback (% of invoice)</span>
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  step="0.1"
                  value={round(settings.holdbackPct * 100)}
                  onChange={(e) => setField("holdbackPct", num(e.target.value) / 100)}
                />
              </label>
            </div>
          </section>

          {/* Tax */}
          <section className="glass-card mt-5 rounded-[12px] p-5">
            <div className="readable-text mb-1 font-display text-xl font-black text-white">Tax</div>
            <div className="readable-text mb-4 text-sm text-white/56">
              Set your state’s rate and what it applies to — every payment quote in the app uses it.
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className={labelClass}>Tax Label</span>
                <input
                  className={inputClass}
                  type="text"
                  value={settings.tax.label}
                  onChange={(e) => setField("tax", { ...settings.tax, label: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Tax Rate (%)</span>
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  step="0.01"
                  value={round(settings.tax.rate * 100)}
                  onChange={(e) => setField("tax", { ...settings.tax, rate: num(e.target.value) / 100 })}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Applies To</span>
                <select
                  className={inputClass}
                  value={settings.tax.basis}
                  onChange={(e) => setField("tax", { ...settings.tax, basis: e.target.value as StoreSettings["tax"]["basis"] })}
                >
                  <option value="price_plus_docfee">Selling price + doc fee</option>
                  <option value="price">Selling price only</option>
                </select>
              </label>
            </div>
          </section>

          {/* Product weights */}
          <section className="glass-card mt-5 rounded-[12px] p-5">
            <div className="readable-text mb-1 font-display text-xl font-black text-white">Product Weights</div>
            <div className="readable-text mb-4 text-sm text-white/56">
              Units each F&amp;I product contributes to PPU. (Kennesaw: UTP = 5, everything else = 1.)
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              {(Object.keys(productLabels) as ProductKey[]).map((key) => (
                <label key={key} className="block">
                  <span className={labelClass}>{productLabels[key]}</span>
                  <input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="1"
                    value={settings.productWeights[key]}
                    onChange={(e) => setWeight(key, num(e.target.value))}
                  />
                </label>
              ))}
            </div>
          </section>

          {/* Targets */}
          <section className="glass-card mt-5 rounded-[12px] p-5">
            <div className="readable-text mb-1 font-display text-xl font-black text-white">Targets</div>
            <div className="readable-text mb-4 text-sm text-white/56">
              Goal lines used across your Dashboard, scorecards, Store Overview &amp; Finance.
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className={labelClass}>Store Delivered Units</span>
                <input className={inputClass} type="number" min="0" value={settings.targets.deliveredUnits} onChange={(e) => setTarget("deliveredUnits", num(e.target.value))} />
              </label>
              <label className="block">
                <span className={labelClass}>Total PVR Goal ($)</span>
                <input className={inputClass} type="number" min="0" value={settings.targets.pvrTotal} onChange={(e) => setTarget("pvrTotal", num(e.target.value))} />
              </label>
              <label className="block">
                <span className={labelClass}>Front PVR Goal ($)</span>
                <input className={inputClass} type="number" min="0" value={settings.targets.frontEnd} onChange={(e) => setTarget("frontEnd", num(e.target.value))} />
              </label>
              <label className="block">
                <span className={labelClass}>Back PVR Goal ($)</span>
                <input className={inputClass} type="number" min="0" value={settings.targets.backEnd} onChange={(e) => setTarget("backEnd", num(e.target.value))} />
              </label>
              <label className="block">
                <span className={labelClass}>PPU Minimum</span>
                <input className={inputClass} type="number" min="0" step="0.1" value={settings.targets.ppuMinimum} onChange={(e) => setTarget("ppuMinimum", num(e.target.value))} />
              </label>
              <label className="block">
                <span className={labelClass}>PPU Elite</span>
                <input className={inputClass} type="number" min="0" step="0.1" value={settings.targets.ppuElite} onChange={(e) => setTarget("ppuElite", num(e.target.value))} />
              </label>
            </div>
          </section>

          {/* Dealer Mission OS Assistant (EILA) */}
          <section className="glass-card mt-5 rounded-[12px] p-5">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-mission-gold" />
              <div className="readable-text font-display text-xl font-black text-white">Dealer Mission OS Assistant (EILA)</div>
            </div>
            <div className="readable-text mb-4 mt-1 text-sm text-white/56">
              EILA is your in-store AI sales manager — she reads the live numbers, audits every deal, and hands reps the word track to close. When on, she&apos;s available to every rep at this store.
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.aiAssistantEnabled !== false}
              onClick={() => setField("aiAssistantEnabled", settings.aiAssistantEnabled === false)}
              className="flex w-full items-center justify-between gap-4 rounded-[12px] border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-mission-gold/40"
            >
              <span className="text-sm font-bold text-white">
                {settings.aiAssistantEnabled !== false ? "On — available to the whole floor" : "Off — hidden for everyone"}
              </span>
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${settings.aiAssistantEnabled !== false ? "bg-mission-gold" : "bg-white/20"}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${settings.aiAssistantEnabled !== false ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </span>
            </button>
          </section>

          <TextingStatusCard />
        </>
      )}
    </div>
  );
}

// Texting go-live status — reads /api/comms/status (admin-only, masked
// values, never a secret). Green when the store can really send; otherwise
// it shows exactly which switch is still off, mirroring docs/TWILIO-GOLIVE.md.
function TextingStatusCard() {
  const [status, setStatus] = useState<{ configured: boolean; credsPresent: boolean; fromNumber: string | null; fromSource?: string | null; digestTo: string | null; dev?: boolean } | null>(null);
  useEffect(() => {
    authHeaders().then((headers) =>
      fetch("/api/comms/status", { headers })
        .then((r) => (r.ok ? r.json() : null))
        .then(setStatus)
        .catch(() => setStatus(null)),
    );
  }, []);
  if (!status) return null;
  const rows: { label: string; ok: boolean; note: string }[] = [
    { label: "Twilio account keys", ok: status.credsPresent, note: status.credsPresent ? "In Vercel" : "Waiting on Twilio to approve the account" },
    { label: "Store texting number", ok: !!status.fromNumber, note: status.fromNumber ? `${status.fromNumber}${status.fromSource === "store" ? " (this store's own)" : " (shared fallback)"}` : "Added for you the day texting is turned on" },
    { label: "Monday digest number", ok: !!status.digestTo, note: status.digestTo ? `Your weekly report texts ${status.digestTo} every Monday at 7am` : "Optional \u2014 your Monday-morning report texts this number" },
  ];
  return (
    <section className="glass-card mt-5 rounded-[12px] p-5">
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-5 w-5 text-mission-gold" />
        <div className="readable-text font-display text-xl font-black text-white">Texting</div>
        <span className={`ml-auto rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${status.configured ? "bg-mission-green/15 text-mission-green" : "bg-white/[0.06] text-white/50"}`}>
          {status.configured ? "Connected" : "Not connected yet"}
        </span>
      </div>
      <div className="readable-text mb-4 mt-1 text-sm text-white/56">
        One connection turns on customer texting for sales, service, and parts — consent-gated everywhere. Once Twilio approves the account, setup takes about five minutes.
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-[12px] border border-white/10 bg-white/[0.035] p-3.5">
            <div className="min-w-0">
              <div className="text-sm font-bold text-white">{row.label}</div>
              <div className="truncate text-xs text-white/50">{row.note}</div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] ${row.ok ? "bg-mission-green/15 text-mission-green" : "bg-white/[0.06] text-white/45"}`}>
              {row.ok ? "Ready" : "Pending"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// Trim float noise from fraction→percent conversion (0.07*100 = 7.000000001).
function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
