"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { authHeaders } from "@/lib/storeClient";

type Latest = { date: string; generatedAt: string; report: string } | null;

// EILA's End-of-Day Brief, on the GM screen. Shows tonight's stored brief and lets
// a manager generate one on demand; the nightly cron writes it automatically.
export function NightlyBrief() {
  const [latest, setLatest] = useState<Latest>(null);
  const [loading, setLoading] = useState(true);
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ai/daily-report", { headers: await authHeaders(), cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { latest?: Latest };
        if (data.latest) setLatest(data.latest);
      } catch {
        // leave empty — the generate button still works
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function generate() {
    setGen(true);
    setErr("");
    try {
      const res = await fetch("/api/ai/daily-report", { method: "POST", headers: { "content-type": "application/json", ...(await authHeaders()) } });
      const data = (await res.json().catch(() => ({}))) as { report?: string; error?: string };
      if (!res.ok || !data.report) setErr(data.error || "Couldn't generate the brief — try again.");
      else setLatest({ date: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(), report: data.report });
    } catch {
      setErr("Couldn't reach EILA — check your connection.");
    } finally {
      setGen(false);
    }
  }

  return (
    <section className="living-border relative overflow-hidden rounded-[20px] border border-white/10 bg-mission-panel/60 p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-mission-green" />
          <span className="font-display text-sm font-black uppercase tracking-[0.14em] text-white">EILA · Nightly Brief</span>
          {latest && <span className="text-[11px] text-white/40">{latest.date}</span>}
        </div>
        <button type="button" onClick={generate} disabled={gen}
          className="inline-flex items-center gap-1.5 rounded-full border border-mission-green/40 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-green transition hover:bg-mission-green hover:text-mission-navy disabled:opacity-60">
          {gen ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Writing…</> : <><RefreshCw className="h-3.5 w-3.5" /> {latest ? "Refresh" : "Generate"}</>}
        </button>
      </div>

      {err && <p className="mt-3 text-sm font-semibold text-mission-red">{err}</p>}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-white/40">Loading tonight&apos;s brief…</p>
        ) : latest ? (
          <Brief md={latest.report} />
        ) : (
          <p className="text-sm leading-relaxed text-white/55">
            No brief yet tonight. Tap <span className="font-bold text-mission-green">Generate</span> and EILA will read the whole floor and write your end-of-day brief — where you stand, the wins, what to fix, and tomorrow&apos;s plan. (She also writes it automatically every night.)
          </p>
        )}
      </div>
    </section>
  );
}

// Lightweight markdown render for the brief — ## headings, bullets, **bold**.
function Brief({ md }: { md: string }) {
  const lines = md.split(/\r?\n/);
  return (
    <div className="space-y-1 text-sm leading-relaxed text-white/85">
      {lines.map((ln, i) => {
        const t = ln.trim();
        if (!t) return <div key={i} className="h-1.5" />;
        if (t.startsWith("## ")) return <h4 key={i} className="mt-3 font-display text-xs font-black uppercase tracking-[0.14em] text-mission-green">{t.slice(3)}</h4>;
        if (t.startsWith("# ")) return <h3 key={i} className="mt-2 font-display text-base font-black text-white">{t.slice(2)}</h3>;
        if (/^[-*]\s/.test(t)) return <div key={i} className="flex gap-2 pl-0.5"><span className="text-mission-green">•</span><span>{bold(t.replace(/^[-*]\s/, ""))}</span></div>;
        return <p key={i}>{bold(t)}</p>;
      })}
    </div>
  );
}

function bold(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="font-bold text-white">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}
