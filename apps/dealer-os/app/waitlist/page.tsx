"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, Copy, Loader2, Mic, RefreshCw, Send, Sparkles, Volume2, VolumeX } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { useAuth } from "@/components/AuthProvider";
import { authHeaders, loadStore, saveStore } from "@/lib/storeClient";
import { useVoice } from "@/lib/voice";
import { currency } from "@/lib/data";
import type { AppPulse } from "@/lib/appPulse";

type ChatMsg = { role: "user" | "assistant"; content: string };
const ADV_QUICK = ["Give me my briefing", "Who should I follow up with?", "What's stalled?", "How do I grow MRR?"];

type Signup = { id: string; email: string; name?: string; source?: string; createdAt?: string };
type PipelineEntry = { stage: Stage; nextAction?: string; notes?: string; value?: number; updatedAt?: string };
type Pipeline = Record<string, PipelineEntry>;
type Stage = "Lead" | "Demo" | "Trial" | "Won" | "Lost";

const money = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

const STAGES: Stage[] = ["Lead", "Demo", "Trial", "Won", "Lost"];
const STAGE_STYLE: Record<Stage, string> = {
  Lead: "bg-white/10 text-white/70",
  Demo: "bg-mission-gold/20 text-mission-gold",
  Trial: "bg-mission-gold/20 text-mission-gold",
  Won: "bg-mission-green/20 text-mission-green",
  Lost: "bg-mission-red/20 text-mission-red",
};

export default function HqPage() {
  const { isOwner } = useAuth();
  const [signups, setSignups] = useState<Signup[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Stage | "All">("All");
  const [copied, setCopied] = useState(false);
  const [pulse, setPulse] = useState<AppPulse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [res, pl, pulseRes] = await Promise.all([
        fetch("/api/waitlist", { headers: { ...(await authHeaders()) } }),
        loadStore<Pipeline>("hqPipeline"),
        fetch("/api/app-pulse", { headers: { ...(await authHeaders()) } }),
      ]);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load.");
      setSignups(Array.isArray(data.waitlist) ? data.waitlist : []);
      setPipeline(pl && typeof pl === "object" ? pl : {});
      const pulseData = await pulseRes.json().catch(() => null);
      if (pulseRes.ok && pulseData) setPulse(pulseData as AppPulse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOwner) void load(); }, [isOwner, load]);

  const update = useCallback((id: string, patch: Partial<PipelineEntry>) => {
    setPipeline((cur) => {
      const base: PipelineEntry = cur[id] ?? { stage: "Lead" };
      const next = { ...cur, [id]: { ...base, ...patch, updatedAt: new Date().toISOString() } };
      void saveStore("hqPipeline", next);
      return next;
    });
  }, []);

  // ── Advisor (AI for the SaaS business) ──
  const [advOpen, setAdvOpen] = useState(false);
  const [advMsgs, setAdvMsgs] = useState<ChatMsg[]>([{ role: "assistant", content: "I'm EILA. I run Commissioned 41 and Dealer Mission OS for you — I see the whole pipeline AND the whole platform. Ask me anything, or have me brief you." }]);
  const [advInput, setAdvInput] = useState("");
  const [advLoading, setAdvLoading] = useState(false);
  const [advVoice, setAdvVoice] = useState(false);
  const advEndRef = useRef<HTMLDivElement>(null);

  const { listening, speaking, inputSupported, outputSupported, startListening, stopListening, speak, stopSpeaking } =
    useVoice({ onInterim: (t) => setAdvInput(t), onFinal: (t) => { setAdvInput(""); void sendAdvisor(t); } });

  useEffect(() => { advEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [advMsgs, advOpen]);

  async function callHq(payload: Record<string, unknown>) {
    const res = await fetch("/api/ai/hq", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(payload) });
    return res.json().catch(() => ({}));
  }

  async function sendAdvisor(textArg?: string) {
    const text = (textArg ?? advInput).trim();
    if (!text || advLoading) return;
    if (/give me my briefing/i.test(text)) { void runBriefing(); return; }
    const cur = advMsgs;
    setAdvMsgs((m) => [...m, { role: "user", content: text }]);
    setAdvInput(""); setAdvLoading(true);
    try {
      const history = cur[0]?.role === "assistant" ? cur.slice(1) : cur;
      const data = await callHq({ action: "chat", message: text, history });
      const reply = data.reply || data.error || "Lost the connection. Try again.";
      setAdvMsgs((m) => [...m, { role: "assistant", content: reply }]);
      if (advVoice && data.reply) speak(reply);
      void load();
    } catch { setAdvMsgs((m) => [...m, { role: "assistant", content: "Network issue. Try again." }]); }
    finally { setAdvLoading(false); }
  }

  async function runBriefing() {
    if (advLoading) return;
    setAdvOpen(true);
    setAdvMsgs((m) => [...m, { role: "user", content: "Give me my briefing" }]);
    setAdvLoading(true);
    try {
      const data = await callHq({ action: "briefing" });
      const reply = data.reply || data.error || "";
      setAdvMsgs((m) => [...m, { role: "assistant", content: reply }]);
      if (advVoice && data.reply) speak(reply);
      void load();
    } catch { setAdvMsgs((m) => [...m, { role: "assistant", content: "Network issue. Try again." }]); }
    finally { setAdvLoading(false); }
  }

  const prospects = useMemo(
    () => signups.map((s) => ({ ...s, ...(pipeline[s.id] || { stage: "Lead" as Stage }) })),
    [signups, pipeline]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { Lead: 0, Demo: 0, Trial: 0, Won: 0, Lost: 0 };
    for (const p of prospects) c[p.stage] = (c[p.stage] || 0) + 1;
    return c;
  }, [prospects]);

  const winRate = useMemo(() => {
    const closed = counts.Won + counts.Lost;
    return closed ? Math.round((counts.Won / closed) * 100) : 0;
  }, [counts]);

  // Company Mission Control — derived from the pipeline, no manual numbers.
  const kpis = useMemo(() => {
    let mrr = 0, active = 0;
    for (const p of prospects) {
      const v = Number(p.value) || 0;
      if (p.stage === "Won") mrr += v;
      else if (p.stage === "Demo" || p.stage === "Trial") active += v;
    }
    return { mrr, active, storesLive: counts.Won };
  }, [prospects, counts]);

  const visible = useMemo(
    () => prospects.filter((p) => filter === "All" || p.stage === filter)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [prospects, filter]
  );

  function copyEmails() {
    const emails = visible.map((p) => p.email).filter(Boolean).join(", ");
    navigator.clipboard.writeText(emails).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); });
  }

  function fmt(iso?: string) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
  }

  if (!isOwner) {
    return (
      <div>
        <SectionHeader title="Commissioned 41 HQ" kicker="Your dealership sales pipeline" icon={Building2} />
        <div className="rounded-[12px] border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/60">This is private to the owner.</div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Commissioned 41 HQ" kicker="EILA's command bridge — pipeline & the whole platform" icon={Building2} />

      {/* EILA Mission Control — the app's live vitals (owner-only) */}
      <section className="rise glass-card mb-5 rounded-[14px] p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="font-display text-lg font-black text-white">EILA · Mission Control</div>
            <span className="live-dot h-2 w-2 rounded-full bg-mission-green" aria-hidden />
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/40">The whole platform, live</div>
        </div>
        {pulse ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {[
                { label: "Stores", value: `${pulse.totals.stores}`, sub: `${pulse.totals.activeStores} active`, tone: "text-white" },
                { label: "Users", value: `${pulse.totals.users}`, sub: "on the platform", tone: "text-white" },
                { label: "Deals", value: pulse.totals.deals.toLocaleString(), sub: "all stores", tone: "text-mission-green" },
                { label: "Total Gross", value: currency(pulse.totals.gross), sub: "tracked", tone: "text-mission-green" },
                { label: "To Fix", value: `${pulse.totals.auditIssues + pulse.totals.storesNeedingSetup}`, sub: "data-health flags", tone: pulse.totals.auditIssues + pulse.totals.storesNeedingSetup ? "text-mission-red" : "text-white" },
                { label: "Errors 24h", value: `${pulse.totals.errors24h}`, sub: "runtime", tone: pulse.totals.errors24h ? "text-mission-red" : "text-white" },
              ].map((t) => (
                <div key={t.label} className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3.5">
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/40">{t.label}</div>
                  <div className={`mt-2 font-display text-2xl font-black leading-none ${t.tone}`}>{t.value}</div>
                  <div className="mt-1 text-[11px] text-white/45">{t.sub}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {pulse.stores.map((s) => {
                const flags: string[] = [];
                if (!s.hasRateSheets) flags.push("no rate sheets");
                if (!s.storeNameSet) flags.push("name unset");
                if (s.newWithoutInvoice) flags.push(`${s.newWithoutInvoice} New w/o invoice`);
                if (s.negativeGross) flags.push(`${s.negativeGross} negative gross`);
                return (
                  <div key={s.orgId} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-white/8 bg-white/[0.02] px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 rounded-full ${flags.length ? "bg-mission-red" : "bg-mission-green"}`} aria-hidden />
                      <span className="font-bold text-white">{s.name}</span>
                      <span className="text-white/45">· {s.deals} deals · {s.users} users</span>
                    </div>
                    <div className="text-xs text-white/45">{flags.length ? `⚠ ${flags.join(" · ")}` : "clean"}</div>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => { setAdvOpen(true); void sendAdvisor("Brief me on Dealer Mission OS itself — adoption, app health, and the top things we should fix first."); }} className="mt-4 inline-flex items-center gap-2 rounded-full bg-mission-green px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-mission-navy transition hover:brightness-110">
              Have EILA brief me on the app
            </button>
          </>
        ) : (
          <div className="text-sm text-white/50">Loading the platform pulse…</div>
        )}
      </section>

      {/* advisor */}
      <section className="mb-5 overflow-hidden rounded-[14px] border border-mission-gold/20 bg-mission-gold/[0.04]">
        <button type="button" onClick={() => setAdvOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
          <span className={`grid h-9 w-9 place-items-center rounded-full bg-mission-gold/15 text-mission-gold ${advLoading || speaking ? "animate-pulse" : ""}`}><Sparkles className="h-4 w-4" /></span>
          <div className="flex-1">
            <div className="font-display text-sm font-black text-white">EILA</div>
            <div className="text-[11px] text-white/50">{listening ? "Listening…" : speaking ? "Speaking…" : "Your chief operator — pipeline, growth & app health"}</div>
          </div>
          <span className="text-xs font-bold text-mission-gold/80">{advOpen ? "Hide" : "Open"}</span>
        </button>

        {advOpen && (
          <div className="border-t border-white/8 p-3">
            <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
              {advMsgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={m.role === "user"
                    ? "max-w-[85%] rounded-[14px] rounded-br-sm bg-mission-gold px-3 py-2 text-sm font-medium text-mission-navy"
                    : "max-w-[88%] whitespace-pre-wrap rounded-[14px] rounded-bl-sm border border-white/8 bg-white/[0.05] px-3 py-2 text-sm leading-6 text-white/88"}>
                    {m.content}
                  </div>
                </div>
              ))}
              {advLoading && <div className="flex justify-start"><div className="rounded-[14px] border border-white/8 bg-white/[0.05] px-3 py-2 text-sm text-white/45">Thinking…</div></div>}
              {advMsgs.length <= 1 && !advLoading && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ADV_QUICK.map((q) => (
                    <button key={q} type="button" onClick={() => void sendAdvisor(q)} className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-xs text-white/72 transition hover:border-mission-gold/45 hover:text-white">{q}</button>
                  ))}
                </div>
              )}
              <div ref={advEndRef} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              {inputSupported && (
                <button type="button" onClick={() => (listening ? stopListening() : startListening())} aria-label="Talk" className={`relative grid h-10 w-10 flex-shrink-0 place-items-center rounded-full border transition ${listening ? "border-mission-red/60 bg-mission-red/20 text-mission-red" : "border-white/10 bg-[#101218] text-white/55 hover:text-white/90"}`}>
                  {listening && <span className="absolute inline-flex h-10 w-10 animate-ping rounded-full bg-mission-red/30" />}
                  <Mic className="relative h-4 w-4" />
                </button>
              )}
              <input
                value={advInput}
                onChange={(e) => setAdvInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendAdvisor(); } }}
                placeholder={listening ? "Listening…" : "Ask EILA…"}
                className="h-10 flex-1 rounded-full border border-white/10 bg-[#101218] px-4 text-sm text-white outline-none focus:border-mission-gold/60"
              />
              {outputSupported && (
                <button type="button" onClick={() => { const n = !advVoice; setAdvVoice(n); if (!n) stopSpeaking(); }} aria-label="Toggle voice" className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-full border transition ${advVoice ? "border-mission-gold/50 bg-mission-gold/15 text-mission-gold" : "border-white/10 bg-[#101218] text-white/45 hover:text-white/80"}`}>
                  {advVoice ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
              )}
              <button type="button" onClick={() => void sendAdvisor()} disabled={advLoading || !advInput.trim()} className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-mission-gold text-mission-navy transition hover:brightness-110 disabled:opacity-40" aria-label="Send">
                {advLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* company mission control — derived from the pipeline */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: "MRR", value: `${money(kpis.mrr)}/mo`, accent: "text-mission-green" },
          { label: "Stores Live", value: String(kpis.storesLive), accent: "text-white" },
          { label: "Active Pipeline", value: `${money(kpis.active)}/mo`, accent: "text-mission-gold" },
          { label: "Win Rate", value: `${winRate}%`, accent: "text-mission-gold" },
        ].map((k) => (
          <div key={k.label} className="glass-card rounded-[14px] p-4">
            <div className={`text-2xl font-black tabular-nums ${k.accent}`}>{k.value}</div>
            <div className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/45">{k.label}</div>
          </div>
        ))}
      </div>

      {/* funnel stages (tap to filter) */}
      <div className="mb-5 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(filter === s ? "All" : s)}
            className={`rounded-[12px] border p-3 text-left transition ${filter === s ? "border-mission-gold/50 bg-mission-gold/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
          >
            <div className="text-2xl font-black tabular-nums text-white">{counts[s]}</div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/45">{s}</div>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="text-sm font-bold text-white/60">{visible.length} {filter === "All" ? "prospects" : filter.toLowerCase()}</div>
        <button type="button" onClick={copyEmails} disabled={visible.length === 0} className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-1.5 text-sm font-bold text-white/80 transition hover:border-mission-gold/50 hover:text-white disabled:opacity-40">
          {copied ? <Check className="h-4 w-4 text-mission-green" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy emails"}
        </button>
        {filter !== "All" && <button type="button" onClick={() => setFilter("All")} className="text-sm font-bold text-mission-gold/80 underline">Clear filter</button>}
        <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-1.5 text-sm font-bold text-white/70 transition hover:text-white">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && <div className="mb-4 rounded-[12px] border border-mission-red/30 bg-mission-red/10 px-4 py-3 text-sm text-mission-red">{error}</div>}

      {loading && prospects.length === 0 ? (
        <div className="glass-card rounded-[14px] p-10 text-center text-sm text-white/50">Loading pipeline…</div>
      ) : visible.length === 0 ? (
        <div className="glass-card rounded-[14px] p-10 text-center text-sm text-white/55">
          {prospects.length === 0 ? <>No prospects yet. Share <span className="text-white">commissioned41.com</span> — signups land here as Leads.</> : "No prospects in this stage."}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((p) => (
            <div key={p.id} className="glass-card rounded-[14px] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-display text-base font-black text-white">{p.email}</div>
                  <div className="mt-0.5 text-xs text-white/45">{p.name || "—"} · {p.source || "landing"} · joined {fmt(p.createdAt)}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${STAGE_STYLE[p.stage]}`}>{p.stage}</span>
              </div>

              {/* stage selector */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => update(p.id, { stage: s })}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${p.stage === s ? STAGE_STYLE[s] : "border border-white/12 text-white/50 hover:text-white/85"}`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* value + next action + notes */}
              <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr]">
                <div className="flex items-center rounded-[10px] border border-white/10 bg-[#14161c]/80 px-3">
                  <span className="text-sm text-white/40">$</span>
                  <input
                    type="number"
                    min="0"
                    defaultValue={p.value ?? ""}
                    onBlur={(e) => { const v = e.target.value === "" ? undefined : Number(e.target.value); if (v !== p.value) update(p.id, { value: v }); }}
                    placeholder="0"
                    className="h-10 w-full bg-transparent text-sm text-white outline-none"
                  />
                  <span className="text-xs text-white/35">/mo</span>
                </div>
                <input
                  defaultValue={p.nextAction || ""}
                  onBlur={(e) => { if (e.target.value !== (p.nextAction || "")) update(p.id, { nextAction: e.target.value }); }}
                  placeholder="Next action (e.g. book demo Tue)"
                  className="h-10 rounded-[10px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none focus:border-mission-gold/60"
                />
                <input
                  defaultValue={p.notes || ""}
                  onBlur={(e) => { if (e.target.value !== (p.notes || "")) update(p.id, { notes: e.target.value }); }}
                  placeholder="Notes"
                  className="h-10 rounded-[10px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none focus:border-mission-gold/60 sm:col-span-2"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
