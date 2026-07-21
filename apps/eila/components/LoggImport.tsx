"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { Sheet } from "./ui";
import { useMission } from "@/lib/store";
import { productDefs } from "@/lib/fni";
import { parseLoggCsv, type LoggImportResult } from "@/lib/loggImport";

// THE LOGG import — paste (or upload) the month's spreadsheet, see exactly how
// every column maps and how each deal lands, then import in one tap. The whole
// point: front/back/products land on the RIGHT deal, not a lump total.
export function LoggImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, importDeals } = useMission();
  const defs = productDefs(data.profile);
  const fileRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState("");
  const [done, setDone] = useState<{ added: number; updated: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const result: LoggImportResult | null = useMemo(() => {
    if (!raw.trim()) return null;
    return parseLoggCsv(raw, defs, { refYear: new Date().getFullYear() });
  }, [raw, defs]);

  const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const mappedFields = result?.columns.filter((c) => c.field) ?? [];
  const mappedProducts = result?.columns.filter((c) => c.productId) ?? [];
  const unmapped = result?.columns.filter((c) => !c.field && !c.productId && c.header.trim()) ?? [];

  // Preview split: how many parsed rows match an existing deal (by Deal #) and
  // will UPDATE it, vs. how many are genuinely new — so the button is honest.
  const existingNums = useMemo(
    () => new Set(data.deals.filter((d) => !d.demo && d.dealNumber).map((d) => d.dealNumber!.trim().toLowerCase())),
    [data.deals],
  );
  const willUpdate = result?.deals.filter((d) => d.dealNumber && existingNums.has(d.dealNumber.trim().toLowerCase())).length ?? 0;
  const willAdd = (result?.deals.length ?? 0) - willUpdate;

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setRaw(String(reader.result ?? ""));
    reader.readAsText(f);
  }

  function doImport() {
    if (!result?.deals.length) return;
    setBusy(true);
    const res = importDeals(result.deals);
    setDone(res);
    setBusy(false);
  }

  function reset() {
    setRaw(""); setDone(null);
    onClose();
  }

  return (
    <Sheet open={open} onClose={reset} title="Import from THE LOGG">
      {done !== null ? (
        <div className="space-y-4 py-6 text-center">
          <CheckCircle2 className="mx-auto text-accent" size={40} />
          <div className="text-lg font-black">
            {[done.added ? `${done.added} added` : "", done.updated ? `${done.updated} updated` : ""].filter(Boolean).join(" · ") || "Nothing to import"}
          </div>
          <div className="text-sm text-fg/65">
            {done.updated
              ? "Re-synced to THE LOGG — existing deals were matched by Deal # and corrected in place, not duplicated. Every number recalculated."
              : "Your month is on the board — front, F&I, and products landed per deal. Every number recalculated."}
          </div>
          <button onClick={reset} className="glass w-full rounded-xl py-3 font-bold text-accent active:scale-95">Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-fg/70">
            In Google Sheets: <span className="font-semibold text-fg">File → Download → CSV</span> (or just select the rows and copy), then paste below. Keep the header row — EILA maps the columns for you.
          </div>

          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"Deal #,Date,Customer,Salesperson,Front,F&I,VSC,GAP,NAS Combo,Maintenance\n1001,7/2,Jane Doe,Rodney,1200,1850,x,,x,"}
            rows={5}
            className="glass w-full resize-y rounded-xl bg-transparent p-3 font-mono text-xs outline-none placeholder:text-fg/30"
          />

          <div className="flex items-center gap-2">
            <button onClick={() => fileRef.current?.click()} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-fg/70 active:scale-95">
              <Upload size={13} /> Upload CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={pickFile} className="hidden" />
            {raw.trim() && <button onClick={() => setRaw("")} className="text-xs font-semibold text-fg/50">Clear</button>}
          </div>

          {result && (
            <div className="space-y-3">
              {/* how the columns mapped */}
              <div className="glass rounded-xl p-3 text-xs">
                <div className="mb-1.5 font-bold text-fg/80">Column mapping</div>
                <div className="flex flex-wrap gap-1.5">
                  {mappedFields.map((c) => (
                    <span key={c.index} className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">{c.header} → {fieldLabel(c.field!)}</span>
                  ))}
                  {mappedProducts.map((c) => (
                    <span key={c.index} className="rounded-full bg-accent2/15 px-2 py-0.5 text-accent2">{c.header} → {defs.find((d) => d.id === c.productId)?.label ?? c.productId}</span>
                  ))}
                  {unmapped.map((c) => (
                    <span key={c.index} className="rounded-full bg-fg/10 px-2 py-0.5 text-fg/40 line-through">{c.header}</span>
                  ))}
                </div>
              </div>

              {result.warnings.length > 0 && (
                <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
                  <div className="mb-1 flex items-center gap-1.5 font-bold"><AlertTriangle size={13} /> Check this before importing</div>
                  <ul className="list-disc space-y-1 pl-4">
                    {result.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {/* per-deal preview */}
              {result.deals.length > 0 && (
                <div className="glass overflow-x-auto rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="text-fg/50">
                      <tr className="border-b border-fg/10">
                        <th className="p-2 font-semibold">Customer</th>
                        <th className="p-2 font-semibold">Date</th>
                        <th className="p-2 text-right font-semibold">Front</th>
                        <th className="p-2 text-right font-semibold">F&I</th>
                        <th className="p-2 font-semibold">Products</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.deals.slice(0, 12).map((d, i) => (
                        <tr key={i} className="border-b border-fg/5 last:border-0">
                          <td className="p-2 font-medium">{d.customer}{d.noQualify ? <span className="ml-1 text-fg/40">(house)</span> : ""}</td>
                          <td className="p-2 text-fg/60">{d.date.slice(5, 10)}</td>
                          <td className="p-2 text-right tabular-nums">{money(d.amount)}</td>
                          <td className="p-2 text-right tabular-nums font-semibold">{money(d.secondary)}</td>
                          <td className="p-2 text-fg/60">{(d.products ?? []).map((id) => defs.find((x) => x.id === id)?.label ?? id).join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.deals.length > 12 && <div className="p-2 text-center text-xs text-fg/40">+ {result.deals.length - 12} more</div>}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-fg/55">
                <span>
                  {willAdd} new{willUpdate ? ` · ${willUpdate} re-synced` : ""}{result.skipped ? ` · ${result.skipped} row${result.skipped === 1 ? "" : "s"} skipped` : ""}
                </span>
                <span>{mappedProducts.length} product columns</span>
              </div>

              <button
                onClick={doImport}
                disabled={busy || !result.deals.length}
                className={clsx(
                  "w-full rounded-xl py-3 text-center font-bold transition active:scale-95",
                  result.deals.length ? "bg-accent text-black" : "glass text-fg/40",
                )}
              >
                {busy ? <Loader2 className="mx-auto animate-spin" size={18} /> : willUpdate ? `Import & re-sync ${result.deals.length}` : `Import ${result.deals.length} ${result.deals.length === 1 ? "deal" : "deals"}`}
              </button>
              <div className="text-center text-[11px] text-fg/40">Deals matched by Deal # are corrected in place (not duplicated); new ones mark delivered + funded. You can edit any deal after.</div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function fieldLabel(f: string): string {
  const map: Record<string, string> = {
    customer: "Customer", dealNumber: "Deal #", date: "Date", salesperson: "Salesperson",
    salesperson2: "Co-sales", item: "Vehicle", bank: "Bank", amount: "Front gross",
    secondary: "F&I gross", reserve: "Reserve", noQualify: "No-qualify",
  };
  return map[f] ?? f;
}
