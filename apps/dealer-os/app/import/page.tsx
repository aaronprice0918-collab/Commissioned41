"use client";

import { useEffect, useState } from "react";
import { ArchiveRestore, Sparkles, Upload } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/components/AuthProvider";
import { useDeals } from "@/components/DealProvider";
import { authHeaders, loadStore, saveStore } from "@/lib/storeClient";
import { applyImport, buildDeal, importMismatches, importTotals, type ImportMismatch, type ImportMode, type ParsedDeal } from "@/lib/dealImport";
import { currency, displayPersonName, productUnits, type Deal } from "@/lib/data";

const MODES: { key: ImportMode; label: (cur: number, inc: number) => string; blurb: string }[] = [
  {
    key: "replace",
    label: (cur, inc) => `Replace all (${cur} → ${inc})`,
    blurb: "Current deals are backed up, then swapped for these. Use when the paste is the full month / source of truth.",
  },
  {
    key: "merge",
    label: (cur, inc) => `Merge by deal # (enrich ${cur})`,
    blurb: "Match incoming deals to existing ones by deal number and enrich them (products, VIN, doc fee fill in); unmatched deals are added. Use to layer a rich personal grid onto deals already loaded from the DMS log.",
  },
  {
    key: "add",
    label: (cur, inc) => `Add to existing (${cur} + ${inc})`,
    blurb: "These deals are added on top of the current ones. Use for a batch you hadn't logged yet.",
  },
];

export default function ImportPage() {
  const { isOwner, isAdmin } = useAuth();
  const { deals, replaceBoardVerified } = useDeals();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [parsed, setParsed] = useState<Deal[] | null>(null);
  const [mode, setMode] = useState<ImportMode>("replace");
  const [done, setDone] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [mismatches, setMismatches] = useState<ImportMismatch[]>([]);
  const [checkedRows, setCheckedRows] = useState(0);
  const [acceptMismatch, setAcceptMismatch] = useState(false);
  const [backup, setBackup] = useState<Deal[] | null>(null);
  const [restoreArmed, setRestoreArmed] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");

  useEffect(() => {
    loadStore<Deal[]>("deals_backup").then((saved) => {
      if (Array.isArray(saved) && saved.length) setBackup(saved);
    });
  }, [done]);

  // Read a dropped/selected file into the paste box. Excel goes through SheetJS
  // (dynamic-imported so it never weighs down the main bundle); CSV/TSV/TXT read
  // natively. The result feeds the same EILA parse flow as a manual paste.
  async function loadFile(file: File) {
    setError("");
    setDone("");
    try {
      const lower = file.name.toLowerCase();
      let content = "";
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        content = wb.SheetNames.map((name) => XLSX.utils.sheet_to_csv(wb.Sheets[name])).join("\n\n");
      } else {
        content = await file.text();
      }
      if (!content.trim()) throw new Error("That file came through empty.");
      setText(content);
      setFileName(file.name);
    } catch (e) {
      setError(`Couldn't read ${file.name}. ${e instanceof Error ? e.message : ""}`);
    }
  }

  if (!isOwner && !isAdmin) {
    return (
      <div>
        <SectionHeader title="Import" kicker="Owner / admin only" />
        <div className="glass-card rounded-[12px] p-6 text-white/70">This screen is limited to owners and admins.</div>
      </div>
    );
  }

  const totals = parsed ? importTotals(parsed) : null;

  async function parse() {
    setBusy(true);
    setError("");
    setParsed(null);
    setDone("");
    try {
      const res = await fetch("/api/ai/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "EILA couldn't parse that.");
      const raw = json.deals as ParsedDeal[];
      const built = raw.map(buildDeal);
      if (!built.length) throw new Error("No deals found in that paste.");
      setParsed(built);
      setMismatches(importMismatches(built, raw));
      setCheckedRows(raw.filter((row) => typeof row.totalGross === "number").length);
      setAcceptMismatch(false);
      setSummary(json.summary || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!parsed) return;
    // Rows that can't reproduce the log's own printed totals do NOT get saved
    // unless the owner explicitly accepts them — money lands in the wrong
    // column silently otherwise.
    if (mismatches.length > 0 && !acceptMismatch) return;
    setBusy(true);
    setError("");
    try {
      // Safety net: snapshot the current deals before any change that rewrites
      // existing rows. If the backup write doesn't confirm, ABORT — never destroy
      // live deals on the strength of a backup we can't prove landed.
      if ((mode === "replace" || mode === "merge") && deals.length) {
        const backedUp = await saveStore("deals_backup", deals);
        if (!backedUp) {
          setError("Couldn't save the backup, so nothing was changed. Your current deals are untouched. Try again.");
          setBusy(false);
          return;
        }
      }
      // The import itself is a VERIFIED write too — "Done" is only ever said
      // about deals that provably landed on the server.
      const next = applyImport(deals, parsed, mode);
      const saved = await replaceBoardVerified(next);
      if (!saved) {
        setError("Couldn't save the deals — nothing was changed. Check your connection and try again.");
        setBusy(false);
        return;
      }
      setDone(
        mode === "replace"
          ? `Done — ${parsed.length} deals are now live (previous ${deals.length} backed up).`
          : mode === "merge"
            ? `Done — merged ${parsed.length} deals by deal # (existing ${deals.length} backed up).`
            : `Done — added ${parsed.length} deals (now ${next.length} total).`
      );
      setParsed(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHeader title="Import" kicker="Paste a deal log — EILA builds the deals" />

      {done && (
        <div className="mb-4 rounded-[12px] border border-mission-green/30 bg-mission-green/10 p-4 text-sm font-bold text-mission-green">
          {done}
        </div>
      )}

      <div className="glass-card rounded-[12px] p-5">
        <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
          <Upload className="h-4 w-4" /> Drop a file or paste a deal log
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void loadFile(f); }}
          className={`mb-3 rounded-[10px] border border-dashed p-4 text-center text-sm transition-colors ${dragging ? "border-mission-gold/60 bg-mission-gold/5" : "border-white/15"}`}
        >
          <input
            id="import-file"
            type="file"
            accept=".csv,.tsv,.txt,.tab,.log,.xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }}
          />
          <label htmlFor="import-file" className="cursor-pointer text-white/65">
            <Upload className="mx-auto mb-1 h-5 w-5 text-white/40" />
            Drop a file (<span className="text-white/80">.xlsx, .csv, .txt</span>) or <span className="font-bold text-mission-gold underline">browse</span>
            {fileName ? <div className="mt-1 text-xs font-bold text-mission-green">Loaded {fileName} — review below, then send to EILA</div> : null}
          </label>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste anything — a Reynolds F&I Manager Deal Log, a spreadsheet copy, or a quick dump of the cars you did today. EILA figures out the format, maps the names to your roster, and builds the deals."
          rows={10}
          className="w-full resize-y rounded-[10px] border border-white/10 bg-black/30 p-3 text-sm text-white/90 outline-none focus:border-mission-gold/40"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-white/40">{text.trim() ? `${text.trim().length.toLocaleString()} characters` : "Nothing pasted yet"}</span>
          <button
            onClick={parse}
            disabled={busy || !text.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-white to-white/80 px-5 py-2.5 text-sm font-black text-black disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" /> {busy && !parsed ? "EILA is reading…" : "Send to EILA"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-[12px] border border-mission-red/30 bg-mission-red/10 p-4 text-sm font-bold text-mission-red">{error}</div>
      )}

      {parsed && totals && (
        <div className="mt-5 glass-card rounded-[12px] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-display text-xl font-black text-white">EILA parsed {parsed.length} deals</div>
            <StatusPill tone="gold">Review before saving</StatusPill>
          </div>
          {summary && <p className="mt-2 text-sm text-white/60">{summary}</p>}

          {/* Checksum — eyeball these against the report's printed totals */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Units", value: `${totals.units}` },
              { label: "Back", value: currency(totals.back) },
              { label: "Front", value: currency(totals.front) },
              { label: "Total", value: currency(totals.total) },
            ].map((cell) => (
              <div key={cell.label} className="rounded-[10px] border border-white/10 bg-white/[0.035] p-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-white/45">{cell.label}</div>
                <div className="mt-1 font-display text-xl font-black text-white">{cell.value}</div>
              </div>
            ))}
          </div>

          {/* Reconciliation — every row must reproduce the log's own printed
              total (front + back + doc fee). A row that can't means a number
              landed in the wrong column; it is not saved without an explicit OK. */}
          {mismatches.length > 0 ? (
            <div className="mt-4 rounded-[12px] border border-mission-red/40 bg-mission-red/10 p-4">
              <div className="text-sm font-black text-mission-red">
                {mismatches.length} {mismatches.length === 1 ? "row doesn't" : "rows don't"} reconcile against the log&apos;s own totals — not saved until you say so.
              </div>
              <ul className="mt-2 space-y-1 text-sm text-white/75">
                {mismatches.slice(0, 8).map((m) => (
                  <li key={m.index}>
                    <span className="font-bold text-white">{m.customer || `Row ${m.index + 1}`}</span>: log prints {currency(m.expected)}, parse adds up to {currency(m.got)}
                  </li>
                ))}
                {mismatches.length > 8 && <li>…and {mismatches.length - 8} more.</li>}
              </ul>
              <label className="mt-3 flex items-start gap-2 text-sm text-white/70">
                <input type="checkbox" checked={acceptMismatch} onChange={(e) => setAcceptMismatch(e.target.checked)} className="mt-1 h-4 w-4 accent-mission-red" />
                I checked these rows against the source — import them as parsed anyway.
              </label>
            </div>
          ) : checkedRows > 0 ? (
            <p className="mt-3 text-xs font-bold text-mission-green">
              ✓ All {checkedRows} rows reconcile against the log&apos;s printed totals.
            </p>
          ) : null}

          <div className="mt-4 max-h-[360px] overflow-auto rounded-[10px] border border-white/8">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="sticky top-0 bg-mission-navy/95 backdrop-blur">
                <tr className="border-b border-mission-gold/20">
                  {["Customer", "Type", "Salesperson", "F&I", "Lender", "Front", "Back", "Total", "Prod"].map((c) => (
                    <th key={c} className="px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-mission-gold">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.map((d) => (
                  <tr key={d.id} className="border-b border-white/6">
                    <td className="px-3 py-2 font-bold text-white">{d.customer}</td>
                    <td className="px-3 py-2 text-white/60">{d.vehicleClass}</td>
                    <td className="px-3 py-2 text-white/72">{displayPersonName(d.salesperson)}</td>
                    <td className="px-3 py-2 text-white/72">{displayPersonName(d.financeManager)}</td>
                    <td className="px-3 py-2 text-white/55">{d.lender}</td>
                    <td className="px-3 py-2 text-white/80">{currency(d.frontGross)}</td>
                    <td className="px-3 py-2 text-white/80">{currency(d.backGrossReserve)}</td>
                    <td className="px-3 py-2 font-black text-white">{currency(d.frontGross + d.backGrossReserve)}</td>
                    <td className="px-3 py-2 font-bold text-mission-gold">{productUnits(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Replace / merge / add */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`rounded-full px-4 py-2 text-sm font-bold ${mode === m.key ? "bg-white text-black" : "border border-white/15 text-white/70"}`}
              >
                {m.label(deals.length, parsed.length)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/45">{MODES.find((m) => m.key === mode)?.blurb}</p>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={commit}
              disabled={busy || (mismatches.length > 0 && !acceptMismatch)}
              className="rounded-full bg-gradient-to-b from-mission-green to-mission-green/80 px-6 py-2.5 text-sm font-black text-black disabled:opacity-40"
            >
              {busy ? "Saving…" : mode === "replace" ? "Back up & replace" : mode === "merge" ? "Back up & merge" : "Add these deals"}
            </button>
            <button onClick={() => setParsed(null)} disabled={busy} className="text-sm font-bold text-white/55">
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Safety net — every replace/merge import snapshots the board first. If
          an import (or anything else) ever goes sideways, the last snapshot can
          be put back on the board from right here. */}
      {backup && (
        <div className="mt-5 glass-card rounded-[12px] p-5">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-white/45">
            <ArchiveRestore className="h-4 w-4" /> Safety net — last backup
          </div>
          <p className="mt-2 text-sm text-white/60">
            {backup.length} deals · {currency(importTotals(backup).total)} total gross — snapshotted automatically the
            last time an import replaced the board.
          </p>
          {restoreMsg && (
            <div className="mt-3 rounded-[10px] border border-mission-green/30 bg-mission-green/10 p-3 text-sm font-bold text-mission-green">{restoreMsg}</div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {!restoreArmed ? (
              <button
                type="button"
                onClick={() => { setRestoreArmed(true); setRestoreMsg(""); }}
                className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold text-white/75 transition hover:border-mission-gold/50 hover:text-white"
              >
                Restore this backup…
              </button>
            ) : (
              <>
                <span className="text-sm font-bold text-mission-red">
                  This replaces the {deals.length} deals currently on the board with the {backup.length} backed-up deals.
                </span>
                <button
                  type="button"
                  disabled={restoreBusy}
                  onClick={async () => {
                    setRestoreBusy(true);
                    const boardBefore = deals;
                    const ok = await replaceBoardVerified(backup);
                    if (ok) {
                      // Swap: the replaced board becomes the new backup, so a
                      // restore is always reversible (restore again = swap back).
                      const swapped = boardBefore.length ? await saveStore("deals_backup", boardBefore) : false;
                      if (swapped) setBackup(boardBefore);
                      setRestoreMsg(`Done — ${backup.length} deals are back on the board.${swapped ? " (The replaced board is the new backup — restore again to swap back.)" : ""}`);
                    } else {
                      setRestoreMsg("");
                      setError("Couldn't restore the backup — nothing was changed. Try again.");
                    }
                    setRestoreBusy(false);
                    setRestoreArmed(false);
                  }}
                  className="rounded-full bg-gradient-to-b from-mission-gold to-mission-gold/80 px-5 py-2.5 text-sm font-black text-mission-navy disabled:opacity-40"
                >
                  {restoreBusy ? "Restoring…" : "Yes — restore the backup"}
                </button>
                <button type="button" disabled={restoreBusy} onClick={() => setRestoreArmed(false)} className="text-sm font-bold text-white/55">
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
