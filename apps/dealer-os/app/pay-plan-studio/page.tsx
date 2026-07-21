"use client";

import { useState } from "react";
import { Camera, FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { authHeaders } from "@/lib/storeClient";
import { classifyPlan, computePay, referencedMetrics, type CompPlan } from "@/lib/payEngine";
import { useCompPlans } from "@/components/CompPlanProvider";
import { describeRule } from "@/components/EnginePayPanel";
import { makeMoney, metricLabel } from "@/lib/payFormat";
import { describeCycle } from "@/lib/payCycle";
import { parseSheet } from "@/lib/spreadsheet";
import { manualSource } from "@/lib/paySource";
import { filesToPayload, type FilePart } from "@/lib/payplanUpload";

// Pay plans run several pages and phones capture one photo at a time, so the
// uploader ACCUMULATES pages (photos and/or PDFs, add as many as needed,
// remove misfires) and sends them to EILA as one document.
const MAX_PAGES = 10;
// Stay under the platform request-body cap (~4.5MB); compressed photo pages
// run ~300KB base64 each, so this comfortably fits a full multi-page plan.
const MAX_TOTAL_B64 = 4_000_000;

type ParsedPlan = CompPlan & { planType?: string; confidence?: string; notes?: string; summary?: string };

// Fallback test fields for a plan whose rules reference no perf metrics (e.g. a
// pure per-deal plan) — so the panel is never empty.
const FALLBACK_TEST_FIELDS = ["units", "netProfit", "totalGross"];

export default function PayPlanStudioPage() {
  const { savePlan, activatePlan, plans } = useCompPlans();
  const [text, setText] = useState("");
  const [pages, setPages] = useState<FilePart[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<ParsedPlan | null>(null);
  const [activated, setActivated] = useState(false);
  const [saved, setSaved] = useState(false);
  const [perf, setPerf] = useState<Record<string, string>>({ pvr: "1400", ppu: "2.0", netProfit: "70000", units: "50", vscPenetration: "60", menuUsage: "100", csiBelow: "0", csiMonthsBelow: "1", uncashedContracts: "0" });
  // Spreadsheet performance import — EILA maps columns → this plan's metric keys.
  const [sheet, setSheet] = useState<{ headers: string[]; rows: Record<string, string | number>[] } | null>(null);
  const [mapping, setMapping] = useState<{ column: string; role: string; metricKey?: string }[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importNotes, setImportNotes] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [who, setWho] = useState("");

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // same file(s) can be re-picked after a remove
    if (!files.length) return;
    setError("");
    try {
      const payload = await filesToPayload(files);
      if (payload.skipped?.length) setError(`Couldn't read ${payload.skipped.join(", ")} — take the photo with the regular camera app or screenshot the page, then add it again.`);
      if (!payload.text && !payload.files?.length) { if (!payload.skipped?.length) setError("Couldn't read that format — use a photo, PDF, or text file."); return; }
      if (payload.text) setText((t) => (t ? `${t}\n\n--- next page ---\n\n${payload.text}` : payload.text!).slice(0, 200_000));
      if (payload.files?.length) {
        setPages((p) => {
          if (p.length + payload.files!.length > MAX_PAGES) setError(`Max ${MAX_PAGES} pages — extras were dropped.`);
          return [...p, ...payload.files!].slice(0, MAX_PAGES);
        });
      }
    } catch {
      setError("Couldn't read that file — try taking the photo again.");
    }
  }

  async function parse() {
    const totalB64 = pages.reduce((n, p) => n + p.dataB64.length, 0) + text.length;
    if (totalB64 > MAX_TOTAL_B64) { setError("That's too much at once — remove a page or two and try again."); return; }
    setBusy(true); setError(""); setPlan(null); setSaved(false);
    try {
      const body: Record<string, unknown> = {};
      if (text.trim()) body.text = text;
      if (pages.length) body.files = pages.map(({ dataB64, mediaType }) => ({ dataB64, mediaType }));
      if (!body.text && !body.files) { setError("Paste the plan, or upload its pages (PDF or photos) first."); setBusy(false); return; }
      const res = await fetch("/api/ai/payplan-parse", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Parse failed."); setBusy(false); return; }
      setPlan(json.plan as ParsedPlan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed.");
    }
    setBusy(false);
  }

  function planId(p: ParsedPlan) {
    return (p.id || `plan-${p.role || "role"}-${p.name?.slice(0, 16) || "plan"}`).replace(/\s+/g, "-").toLowerCase();
  }
  function save(): string | null {
    if (!plan) return null;
    const id = planId(plan);
    savePlan({ ...plan, id });
    setSaved(true);
    return id;
  }
  function saveAndActivate() {
    const id = save();
    if (id) { activatePlan(id); setActivated(true); }
  }

  // Upload a performance spreadsheet and let EILA map its columns to this plan's
  // metric keys (the day-one integration for any industry — no per-vendor API).
  async function onSheet(f: File | undefined) {
    if (!f || !plan) return;
    setImportBusy(true); setImportErr(""); setImportNotes(""); setMapping(null); setPeople([]); setWho("");
    try {
      const data = await parseSheet(f);
      if (!data.headers.length) { setImportErr("Couldn't read any columns from that file."); setImportBusy(false); return; }
      setSheet(data);
      const metrics = plan.vocab?.metrics?.length ? plan.vocab.metrics : referencedMetrics(plan as CompPlan).map((k) => ({ key: k, label: metricLabel(k, plan.vocab) }));
      const res = await fetch("/api/ai/perf-map", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ headers: data.headers, sample: data.rows.slice(0, 10), metrics }) });
      const json = await res.json();
      if (!res.ok) { setImportErr(json.error || "Mapping failed."); setImportBusy(false); return; }
      const map = (json.mapping ?? []) as { column: string; role: string; metricKey?: string }[];
      setMapping(map); setImportNotes(json.notes || "");
      const nameCol = map.find((m) => m.role === "name")?.column;
      const names = nameCol ? Array.from(new Set(data.rows.map((r) => String(r[nameCol] ?? "").trim()).filter(Boolean))) : [];
      setPeople(names); setWho(names[0] ?? "");
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Import failed.");
    }
    setImportBusy(false);
  }

  // Turn the mapped rows (optionally for one person) into a performance snapshot
  // and drop it into the test fields, so the existing engine preview renders it.
  function applyImport() {
    if (!sheet || !mapping) return;
    const nameCol = mapping.find((m) => m.role === "name")?.column;
    const metricCols = mapping.filter((m) => m.role === "metric" && m.metricKey);
    const rows = who && nameCol ? sheet.rows.filter((r) => String(r[nameCol] ?? "").trim() === who) : sheet.rows;
    const records = rows.map((r) => Object.fromEntries(metricCols.map((m) => [m.metricKey as string, r[m.column]])));
    const snap = manualSource().toPerformance(records);
    setPerf((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, String(Math.round(Number(v) * 100) / 100)])) }));
  }

  // Live validation via the engine.
  const engineType = plan ? classifyPlan(plan as CompPlan) : null;
  const perfNums: Record<string, number> = Object.fromEntries(Object.entries(perf).map(([k, v]) => [k, Number(v) || 0]));
  const result = plan && engineType !== "unsupported" ? computePay(plan as CompPlan, perfNums) : null;
  // Test inputs are exactly the perf metrics THIS plan reads — for any industry,
  // not a hardcoded automotive list. Labels come from the plan's vocabulary.
  const testFields = plan ? (() => { const m = referencedMetrics(plan as CompPlan); return m.length ? m : FALLBACK_TEST_FIELDS; })() : [];
  const money = makeMoney(plan?.vocab);

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeader title="Pay Plan Studio" kicker="Drop any pay plan — EILA turns it into rules" />

      {/* Input */}
      <section className="glass-card rounded-[16px] p-5">
        <p className="mb-3 text-sm leading-6 text-white/60">Paste a pay plan, or upload its PDF or photos — multi-page welcome: snap each page and add them one at a time. EILA reads it all as one document and extracts the exact rules — flat, tiered, grid, bonuses, penalties, draws — into the compensation engine. Review it, test it with real numbers, then save.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the pay plan text here…"
          className="min-h-[140px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none focus:border-mission-gold/60"
        />
        {pages.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {pages.map((p, i) => (
              <li key={i} className="flex items-center gap-2 rounded-[10px] border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/70">
                <FileText className="h-4 w-4 shrink-0 text-mission-gold" />
                <span className="min-w-0 flex-1 truncate">Page {i + 1} · {p.name}</span>
                <button type="button" aria-label={`Remove page ${i + 1}`} onClick={() => setPages((ps) => ps.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4 text-white/40 hover:text-white" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/12 px-4 py-2.5 text-sm font-bold text-white/75 transition hover:border-mission-gold/40 hover:text-white">
            {pages.length ? <Camera className="h-4 w-4" /> : <Upload className="h-4 w-4" />} {pages.length ? "Add another page" : "Upload PDF / photos"}
            <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,.rtf,.csv,.md,image/*,application/pdf" className="hidden" onChange={onFiles} />
          </label>
          <button type="button" onClick={parse} disabled={busy} className="ml-auto inline-flex items-center gap-2 rounded-full bg-mission-gold px-5 py-2.5 text-sm font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-50">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> EILA is reading…</> : <><Sparkles className="h-4 w-4" /> Have EILA read it{pages.length > 1 ? ` (${pages.length} pages)` : ""}</>}
          </button>
        </div>
        {error && <div className="mt-3 rounded-[12px] border border-mission-red/30 bg-mission-red/10 p-3 text-sm text-mission-red">{error}</div>}
      </section>

      {/* Review */}
      {plan && (
        <section className="glass-card mt-5 rounded-[16px] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display text-2xl font-black text-white">{plan.name}</div>
              <div className="mt-0.5 text-sm text-white/55">{plan.summary}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {plan.role && <StatusPill tone="blue">{plan.role}</StatusPill>}
              <StatusPill tone={engineType === "unsupported" ? "red" : "gold"}>{engineType} plan</StatusPill>
              <StatusPill tone={plan.confidence === "high" ? "green" : plan.confidence === "low" ? "red" : "amber"}>{plan.confidence} confidence</StatusPill>
            </div>
          </div>

          {plan.notes && <div className="mb-4 rounded-[12px] border border-mission-gold/25 bg-mission-gold/[0.06] p-3 text-sm leading-6 text-white/70">⚠ EILA&apos;s note: {plan.notes}</div>}

          {plan.cycle && (
            <div className="mb-4 rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70">
              🗓 <span className="font-bold text-white/85">Pay cycle:</span> {describeCycle(plan.cycle)}
            </div>
          )}

          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-white/45">Extracted rules ({plan.rules?.length ?? 0})</div>
          <ul className="mt-2 space-y-1.5">
            {(plan.rules ?? []).map((r, i) => (
              <li key={i} className="rounded-[10px] border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/80">{describeRule(r, plan.vocab)}</li>
            ))}
          </ul>

          {/* Test */}
          <div className="mt-5 rounded-[12px] border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-mission-gold">Test it with real numbers</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {testFields.map((k) => (
                <label key={k} className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">{metricLabel(k, plan.vocab)}</span>
                  <input value={perf[k] ?? ""} onChange={(e) => setPerf((p) => ({ ...p, [k]: e.target.value }))} className="h-9 w-full rounded-[8px] border border-white/10 bg-[#14161c]/80 px-2 text-center text-sm text-white outline-none focus:border-mission-gold/60" />
                </label>
              ))}
            </div>
            {result ? (
              <div className="mt-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <TestStat label="Rate" value={`${result.effectiveRatePct.toFixed(1)}%`} tone="gold" />
                  <TestStat label="Gross" value={money(Math.round(result.grossCommission))} />
                  <TestStat label="Net (after draw)" value={money(Math.round(result.netEstimatedPay))} tone="green" />
                  <TestStat label="Confidence" value={result.confidence} />
                </div>
                {result.opportunities.length > 0 && (
                  <div className="mt-3 text-sm text-white/70"><span className="font-bold text-mission-gold">Best move: </span>{result.opportunities[0].label} — {result.opportunities[0].detail}</div>
                )}
                <details className="group mt-3">
                  <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.14em] text-white/45 hover:text-white/70">How it calculated</summary>
                  <ul className="mt-2 space-y-1 border-l border-white/10 pl-4 text-xs leading-5 text-white/60">
                    {result.explanation.map((l, i) => <li key={i}>{l}</li>)}
                    {result.warnings.map((w, i) => <li key={`w${i}`} className="text-mission-gold/80">⚠ {w}</li>)}
                  </ul>
                </details>
              </div>
            ) : (
              <div className="mt-3 text-sm text-mission-red">This plan has no calculable base rule (flat, tier, or grid) — it can&apos;t be tested until one is added. That&apos;s the reason, surfaced rather than an empty result.</div>
            )}
          </div>

          {/* Import real performance from a spreadsheet — EILA maps the columns. */}
          <div className="mt-5 rounded-[12px] border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-mission-gold">Import performance (spreadsheet)</div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/12 px-3 py-1.5 text-xs font-bold text-white/75 transition hover:border-mission-gold/40 hover:text-white">
                {importBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload .xlsx / .csv
                <input type="file" accept=".xlsx,.xls,.csv,.tsv" className="hidden" onChange={(e) => onSheet(e.target.files?.[0])} />
              </label>
            </div>
            <p className="text-xs leading-5 text-white/50">Drop a real performance export — EILA matches its columns to this plan&apos;s metrics, then loads the numbers into the test above.</p>
            {importErr && <div className="mt-2 rounded-[10px] border border-mission-red/30 bg-mission-red/10 p-2 text-xs text-mission-red">{importErr}</div>}
            {mapping && (
              <div className="mt-3">
                <div className="flex flex-wrap gap-1.5">
                  {mapping.map((m) => (
                    <span key={m.column} className={`rounded-full border px-2 py-1 text-[11px] ${m.role === "metric" ? "border-mission-green/30 bg-mission-green/10 text-mission-green" : m.role === "ignore" ? "border-white/10 bg-white/[0.03] text-white/40" : "border-white/20 bg-white/[0.04] text-white/70"}`}>
                      {m.column} → {m.role === "metric" ? metricLabel(m.metricKey || "", plan.vocab) : m.role}
                    </span>
                  ))}
                </div>
                {importNotes && <div className="mt-2 text-xs text-white/50">⚠ {importNotes}</div>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {people.length > 0 && (
                    <select value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-[8px] border border-white/10 bg-[#14161c]/80 px-2 text-sm text-white outline-none focus:border-mission-gold/60">
                      {people.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={applyImport} className="inline-flex items-center gap-2 rounded-full bg-mission-green px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110">Load into test{people.length ? ` (${who || "—"})` : ""}</button>
                  <span className="text-xs text-white/45">{sheet ? `${sheet.rows.length} rows` : ""}</span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-black uppercase tracking-[0.12em] text-white/75 transition hover:border-white/35 hover:text-white">Save</button>
            <button type="button" onClick={saveAndActivate} disabled={engineType === "unsupported"} className="inline-flex items-center gap-2 rounded-full bg-mission-green px-5 py-2.5 text-sm font-black uppercase tracking-[0.12em] text-mission-navy transition hover:brightness-110 disabled:opacity-40">Save &amp; activate{plan.role ? ` for ${plan.role}` : ""}</button>
            {activated ? (
              <span className="text-sm font-bold text-mission-green">Live ✓ — now driving {plan.role || "this role"}&apos;s scorecard pay</span>
            ) : saved ? (
              <span className="text-sm font-bold text-white/60">Saved (not yet activated)</span>
            ) : null}
          </div>
          {plans.some((p) => p.active && p.role === plan.role && p.id !== planId(plan)) && (
            <div className="mt-2 text-xs text-mission-gold/80">Activating replaces the plan currently live for {plan.role}.</div>
          )}
        </section>
      )}
    </div>
  );
}

function TestStat({ label, value, tone }: { label: string; value: string; tone?: "gold" | "green" }) {
  return (
    <div className="rounded-[10px] border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">{label}</div>
      <div className={`mt-1 font-display text-lg font-black ${tone === "gold" ? "text-mission-gold" : tone === "green" ? "text-mission-green" : "text-white"}`}>{value}</div>
    </div>
  );
}
