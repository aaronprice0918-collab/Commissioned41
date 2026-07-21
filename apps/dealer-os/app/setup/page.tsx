"use client";

import { useEffect, useState } from "react";
import { Sparkles, Upload, Fuel, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { authHeaders, loadStore, saveStore } from "@/lib/storeClient";
import {
  DOC_TYPES,
  docTypeDef,
  summarizeExtraction,
  extractionIsEmpty,
  type DocType,
  type ExtractedData,
  type MonthlySetup,
  type RateSheetData,
  type IncentivesData,
  type ResidualsData,
} from "@/lib/monthlySetup";

// Read a file into the shape the /api/ai/setup route wants. A PDF goes to EILA
// as a real document (base64) so he reads the laid-out tables; everything else
// (CSV/TSV/TXT/pasted) goes as text. Excel is flattened to CSV via SheetJS.
async function readFile(file: File): Promise<{ text?: string; fileBase64?: string; mediaType?: string }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(file);
    });
    return { fileBase64: dataUrl.split(",")[1] ?? "", mediaType: "application/pdf" };
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    return { text: wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n") };
  }
  return { text: await file.text() };
}

export default function SetupPage() {
  const { isOwner, isAdmin, profile } = useAuth();
  const [docType, setDocType] = useState<DocType>("rateSheets");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; payload: Awaited<ReturnType<typeof readFile>> } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [parsed, setParsed] = useState<ExtractedData | null>(null);
  const [done, setDone] = useState("");
  const [live, setLive] = useState<MonthlySetup | null>(null);

  // What's currently loaded, so the admin sees what they're about to replace.
  useEffect(() => {
    void loadStore<MonthlySetup>("monthlySetup").then((s) => setLive(s));
  }, [done]);

  function reset() {
    setText("");
    setFile(null);
    setParsed(null);
    setSummary("");
    setError("");
  }

  async function pickFile(f: File) {
    setError("");
    setDone("");
    try {
      const payload = await readFile(f);
      if (payload.text !== undefined && !payload.text.trim()) throw new Error("That file came through empty.");
      if (payload.text !== undefined) setText(payload.text);
      setFile({ name: f.name, payload });
    } catch (e) {
      setError(`Couldn't read ${f.name}. ${e instanceof Error ? e.message : ""}`);
    }
  }

  if (!isOwner && !isAdmin) {
    return (
      <div>
        <SectionHeader title="Monthly Setup" kicker="Owner / admin only" />
        <div className="glass-card rounded-[12px] p-6 text-white/70">This screen is limited to owners and admins.</div>
      </div>
    );
  }

  async function parse() {
    setBusy(true);
    setError("");
    setParsed(null);
    setDone("");
    try {
      const body: Record<string, unknown> = { docType };
      if (file?.payload.fileBase64) {
        body.fileBase64 = file.payload.fileBase64;
        body.mediaType = file.payload.mediaType;
        body.fileName = file.name;
      } else {
        body.text = text;
      }
      const res = await fetch("/api/ai/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "EILA couldn't read that.");
      const data = json.data as ExtractedData;
      if (extractionIsEmpty(docType, data)) throw new Error("EILA didn't find any rows to pull from that document.");
      setParsed(data);
      setSummary(json.summary || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!parsed) return;
    setBusy(true);
    setError("");
    try {
      // Merge into the existing setup so loading a new rate sheet doesn't wipe the
      // incentives/residuals already loaded. Each doc type is stamped on save.
      const current = (await loadStore<MonthlySetup>("monthlySetup")) ?? {};
      const stamped = {
        ...(parsed as object),
        updatedAt: new Date().toISOString(),
        updatedBy: profile?.employeeName || profile?.displayName || profile?.email || "",
        sourceFile: file?.name || "pasted",
      };
      const next: MonthlySetup = { ...current, [docType]: stamped } as MonthlySetup;
      const ok = await saveStore("monthlySetup", next);
      if (!ok) {
        setError("Couldn't save — nothing changed. Try again.");
        setBusy(false);
        return;
      }
      setDone(`${docTypeDef(docType).label} is live — EILA is now quoting from it.`);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  const canSend = !!(file?.payload.fileBase64 || text.trim());

  return (
    <div>
      <SectionHeader title="Monthly Setup" kicker="Feed EILA this month's rates, rebates & residuals" />

      {done && (
        <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-mission-green/30 bg-mission-green/10 p-4 text-sm font-bold text-mission-green">
          <CheckCircle2 className="h-4 w-4" /> {done}
        </div>
      )}

      {/* What kind of document — each shares the same drop → confirm → live pipeline */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        {DOC_TYPES.map((d) => {
          const loaded = live?.[d.key];
          const active = docType === d.key;
          return (
            <button
              key={d.key}
              onClick={() => { setDocType(d.key); reset(); }}
              className={clsx(
                "glass-card rounded-[12px] p-4 text-left transition-colors",
                active ? "border-mission-gold/50 bg-mission-gold/[0.07]" : "border-white/10 hover:border-white/20"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={clsx("text-sm font-black", active ? "text-mission-gold" : "text-white/85")}>{d.label}</span>
                {loaded ? <StatusPill tone="green">Loaded</StatusPill> : <StatusPill tone="blue">Empty</StatusPill>}
              </div>
              <p className="mt-1 text-xs text-white/50">{d.blurb}</p>
              {loaded?.effectiveMonth && <p className="mt-1 text-[11px] font-bold text-white/40">Effective {loaded.effectiveMonth}</p>}
            </button>
          );
        })}
      </div>

      <div className="glass-card rounded-[12px] p-5">
        <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
          <Fuel className="h-4 w-4" /> Drop the {docTypeDef(docType).label.toLowerCase()} — EILA reads it
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void pickFile(f); }}
          className={clsx(
            "mb-3 rounded-[10px] border border-dashed p-4 text-center text-sm transition-colors",
            dragging ? "border-mission-gold/60 bg-mission-gold/5" : "border-white/15"
          )}
        >
          <input
            id="setup-file"
            type="file"
            accept=".pdf,.csv,.tsv,.txt,.xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); }}
          />
          <label htmlFor="setup-file" className="cursor-pointer text-white/65">
            <Upload className="mx-auto mb-1 h-5 w-5 text-white/40" />
            Drop a <span className="text-white/80">PDF</span> (or .xlsx/.csv) or <span className="font-bold text-mission-gold underline">browse</span>
            {file ? <div className="mt-1 text-xs font-bold text-mission-green">Loaded {file.name} — send to EILA below</div> : null}
          </label>
        </div>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); if (file?.payload.fileBase64) setFile(null); }}
          placeholder={`Or paste the ${docTypeDef(docType).label.toLowerCase()} here. ${docTypeDef(docType).examples}`}
          rows={8}
          className="w-full resize-y rounded-[10px] border border-white/10 bg-black/30 p-3 text-sm text-white/90 outline-none focus:border-mission-gold/40"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-white/40">
            {file?.payload.fileBase64 ? `PDF ready: ${file.name}` : text.trim() ? `${text.trim().length.toLocaleString()} characters` : "Nothing loaded yet"}
          </span>
          <button
            onClick={parse}
            disabled={busy || !canSend}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-white to-white/80 px-5 py-2.5 text-sm font-black text-black disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" /> {busy && !parsed ? "EILA is reading…" : "Send to EILA"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-[12px] border border-mission-red/30 bg-mission-red/10 p-4 text-sm font-bold text-mission-red">{error}</div>
      )}

      {parsed && (
        <div className="mt-5 glass-card rounded-[12px] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display text-xl font-black text-white">Here&apos;s what EILA pulled</div>
              <div className="mt-0.5 text-sm font-bold text-mission-gold">{summarizeExtraction(docType, parsed)}</div>
            </div>
            <StatusPill tone="gold">Confirm before it goes live</StatusPill>
          </div>
          {summary && <p className="mt-2 text-sm text-white/60">{summary}</p>}

          <div className="mt-4 max-h-[420px] overflow-auto rounded-[10px] border border-white/10">
            <SetupPreview docType={docType} data={parsed} />
          </div>

          <div className="mt-4 flex items-center justify-end gap-3">
            <button onClick={reset} disabled={busy} className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold text-white/70 disabled:opacity-40">
              Discard
            </button>
            <button
              onClick={commit}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-mission-green px-5 py-2.5 text-sm font-black text-black disabled:opacity-40"
            >
              <CheckCircle2 className="h-4 w-4" /> {busy ? "Saving…" : "Confirm — make it live"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const pct = (n?: number) => (n == null ? "—" : `${(+n).toFixed(2)}%`);
const th = "px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.12em] text-white/40";
const td = "px-3 py-2 text-sm text-white/85";

function SetupPreview({ docType, data }: { docType: DocType; data: ExtractedData }) {
  if (docType === "rateSheets") {
    const d = data as RateSheetData;
    return (
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-black/60 backdrop-blur">
          <tr><th className={th}>Lender</th><th className={th}>Tier</th><th className={th}>Year</th><th className={th}>Term</th><th className={th}>Buy rate</th><th className={th}>Max adv.</th></tr>
        </thead>
        <tbody>
          {d.lenders.flatMap((l) =>
            l.tiers.flatMap((t) =>
              t.rates.map((r, i) => (
                <tr key={`${l.lender}-${t.tier}-${r.year ?? ""}-${r.termMonths}-${i}`} className="border-t border-white/[0.06]">
                  <td className={td}>{l.lender}</td><td className={td}>{t.tier}</td><td className={td}>{r.year || "—"}</td><td className={td}>{r.termMonths}mo</td>
                  <td className={clsx(td, "font-bold text-mission-gold")}>{pct(r.buyRate)}</td><td className={td}>{r.maxAdvancePct ? `${r.maxAdvancePct}%` : "—"}</td>
                </tr>
              ))
            )
          )}
        </tbody>
      </table>
    );
  }
  if (docType === "incentives") {
    const d = data as IncentivesData;
    return (
      <table className="w-full border-collapse">
        <thead className="sticky top-0 bg-black/60 backdrop-blur">
          <tr><th className={th}>Model</th><th className={th}>Offer</th><th className={th}>Detail</th><th className={th}>Expires</th></tr>
        </thead>
        <tbody>
          {d.offers.map((o, i) => (
            <tr key={i} className="border-t border-white/[0.06]">
              <td className={td}>{o.model}</td><td className={td}>{o.offerType}</td>
              <td className={clsx(td, "font-bold text-mission-gold")}>{o.detail}</td><td className={td}>{o.expires || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const d = data as ResidualsData;
  return (
    <table className="w-full border-collapse">
      <thead className="sticky top-0 bg-black/60 backdrop-blur">
        <tr><th className={th}>Model</th><th className={th}>Term</th><th className={th}>Mileage</th><th className={th}>Residual</th><th className={th}>Money factor</th></tr>
      </thead>
      <tbody>
        {d.rows.map((r, i) => (
          <tr key={i} className="border-t border-white/[0.06]">
            <td className={td}>{r.model}</td><td className={td}>{r.termMonths}mo</td><td className={td}>{r.mileage}k</td>
            <td className={clsx(td, "font-bold text-mission-gold")}>{pct(r.residualPct)}</td><td className={td}>{r.moneyFactor ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
