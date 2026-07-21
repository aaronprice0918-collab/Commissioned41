"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FolderCheck, FolderOpen, Minus, Pencil, Printer, Sparkles } from "lucide-react";
import {
  cycleJacketState,
  jacketSections,
  jacketStatus,
  normalizeJacketOrder,
  type JacketDocState,
} from "@/lib/dealJacket";
import { canonicalPersonName, displayFullPersonName, type Deal } from "@/lib/data";
import { jacketFileDaysLeft, jacketFileFresh } from "@/lib/jacketFile";
import { askIla } from "@/lib/askIla";
import { authHeaders } from "@/lib/storeClient";
import { JacketScanSort } from "@/components/JacketScanSort";

// Open the filed blue-folder PDF via a short-lived signed URL from the server
// (the bucket is private; the URL is minted org-scoped).
async function openJacketFile(path: string) {
  const tab = window.open("", "_blank");
  try {
    const res = await fetch(`/api/jacket-file?path=${encodeURIComponent(path)}`, { headers: await authHeaders() });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (data.url && tab) tab.location.href = data.url;
    else tab?.close();
  } catch {
    tab?.close();
  }
}

// The deal-jacket checklist — the store's required document order, tapped off
// while the F&I manager cleans a signed deal, plus a printable cover sheet in
// that exact order. The order itself comes from storeSettings (lib/dealJacket
// is the single brain; EILA's deal_jacket tool reads the same functions).
//
// Tap a row to cycle: missing → in the jacket → N/A → missing.

export function DealJacketCard({
  deal,
  order,
  storeName,
  canEditOrder,
  onSetDoc,
  onMarkFiled,
  onSaveOrder,
  onFiled,
}: {
  deal: Deal;
  order: string[];
  storeName: string;
  canEditOrder: boolean;
  onSetDoc: (doc: string, state: JacketDocState) => void;
  /** Bulk "these docs are in the file" from Scan and Sort — ONE deal update,
   * because per-doc calls in a loop would each read the stale deal. */
  onMarkFiled: (docs: string[]) => void;
  onSaveOrder: (order: string[]) => void;
  /** Blue-folder ref after Scan and Sort files the sorted PDF — stored on the deal. */
  onFiled: (file: { path: string; pages: number; savedAt: string }) => void;
}) {
  const status = useMemo(() => jacketStatus(deal, order), [deal, order]);
  // Group the flat order into the cover sheet's real sections (Deal Pack, Bank
  // Pack, …) for display; item state/position still comes from the flat status.
  const sections = useMemo(() => {
    const byDoc = new Map(status.items.map((item) => [item.doc, item]));
    return jacketSections(order).map((s) => ({
      name: s.name,
      items: s.docs.map((doc) => byDoc.get(doc)).filter((x): x is (typeof status.items)[number] => !!x),
    }));
  }, [order, status]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function startEdit() {
    setDraft(order.join("\n"));
    setEditing(true);
  }
  function saveEdit() {
    const next = normalizeJacketOrder(draft);
    if (!next.length) return;
    onSaveOrder(next);
    setEditing(false);
  }

  return (
    <section className="glass-card rounded-[12px] p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-display text-lg font-black text-white">
          <FolderCheck className="h-5 w-5 text-mission-gold" /> Deal Jacket
        </div>
        <div className={`text-xs font-black ${status.complete ? "text-mission-green" : "text-mission-gold"}`}>
          {status.have}/{status.required} in order{status.na ? ` · ${status.na} N/A` : ""}
        </div>
      </div>
      <p className="mb-4 text-xs leading-5 text-white/45">
        The store&apos;s required document order. Tap a doc as it goes into the file — then print the cover
        sheet and the jacket walks to the office in sequence.
      </p>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(16, Math.max(8, draft.split("\n").length + 1))}
            className="w-full rounded-[12px] border border-white/12 bg-[#14161c]/80 px-3 py-2 text-sm leading-6 text-white outline-none focus:border-mission-gold/60"
            aria-label="Deal jacket document order, one document per line"
          />
          <p className="mt-1 text-[11px] text-white/40">One document per line, in the exact stack order.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={saveEdit} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-[12px] bg-mission-gold px-3 text-xs font-black uppercase tracking-[0.12em] text-mission-navy">
              Save Order
            </button>
            <button type="button" onClick={() => setEditing(false)} className="inline-flex min-h-10 flex-1 items-center justify-center rounded-[12px] border border-white/15 px-3 text-xs font-black uppercase tracking-[0.12em] text-white/70">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section.name || "order"}>
                {section.name && (
                  <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-mission-gold/80">{section.name}</div>
                )}
                <ol className="space-y-1.5">
                  {section.items.map((item) => (
                    <li key={item.doc}>
                      <button
                        type="button"
                        onClick={() => onSetDoc(item.doc, cycleJacketState(item.state))}
                        className={`flex w-full items-center gap-3 rounded-[10px] border px-3 py-2 text-left transition ${
                          item.state === "have"
                            ? "border-mission-green/35 bg-mission-green/[0.07]"
                            : item.state === "na"
                              ? "border-white/8 bg-white/[0.02] opacity-55"
                              : "border-white/10 bg-white/[0.03] hover:border-mission-gold/40"
                        }`}
                        aria-label={`${item.doc}: ${item.state === "have" ? "in the jacket" : item.state === "na" ? "not applicable" : "missing"} — tap to change`}
                      >
                        <span className="w-5 shrink-0 text-right font-display text-xs font-black tabular-nums text-white/35">{item.position}</span>
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                            item.state === "have"
                              ? "border-mission-green bg-mission-green text-mission-navy"
                              : item.state === "na"
                                ? "border-white/25 text-white/40"
                                : "border-mission-gold/50 text-transparent"
                          }`}
                        >
                          {item.state === "have" ? <Check className="h-3 w-3" /> : item.state === "na" ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                        </span>
                        <span className={`min-w-0 flex-1 text-sm ${item.state === "missing" ? "text-white/80" : "text-white/60"}`}>{item.doc}</span>
                        {item.state === "na" && <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-white/35">N/A</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[12px] bg-mission-gold px-3 text-xs font-black uppercase tracking-[0.12em] text-mission-navy"
            >
              <Printer className="h-4 w-4" /> Print Cover Sheet
            </button>
            <button
              type="button"
              onClick={() =>
                askIla(
                  `Deal jacket check for ${deal.customer}${deal.dealNumber ? ` (deal #${deal.dealNumber})` : ""} — what's missing and what order does the file go in?`
                )
              }
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] border border-white/15 px-3 text-xs font-black uppercase tracking-[0.12em] text-white/70 transition hover:border-mission-gold/50 hover:text-white"
            >
              <Sparkles className="h-4 w-4" /> Ask EILA
            </button>
            {canEditOrder && (
              <button
                type="button"
                onClick={startEdit}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] border border-white/15 px-3 text-xs font-black uppercase tracking-[0.12em] text-white/70 transition hover:border-white/35 hover:text-white"
                aria-label="Edit the store's jacket order"
              >
                <Pencil className="h-4 w-4" /> Order
              </button>
            )}
          </div>

          {/* THE BLUE FOLDER — the filed sorted PDF, held 90 days on the deal. */}
          {jacketFileFresh(deal.jacketFile) && deal.jacketFile && (
            <button
              type="button"
              onClick={() => void openJacketFile(deal.jacketFile!.path)}
              className="mt-4 flex w-full items-center gap-3 rounded-[12px] border border-sky-400/40 bg-sky-400/[0.07] px-4 py-3 text-left transition hover:border-sky-400/70"
            >
              <FolderOpen className="h-5 w-5 shrink-0 text-sky-400" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-white">Sorted jacket on file</span>
                <span className="block text-xs text-white/50">
                  {deal.jacketFile.pages} pages · filed {deal.jacketFile.savedAt.slice(0, 10)} · {jacketFileDaysLeft(deal.jacketFile)} days left, then EILA lets it go
                </span>
              </span>
            </button>
          )}

          {/* SCAN AND SORT — drop the scanned stack, get it back in order; every
              doc EILA sees gets checked off as filed. */}
          <JacketScanSort order={order} customer={deal.customer} dealId={deal.id} onDocsFound={onMarkFiled} onFiled={onFiled} />
        </>
      )}

      {/* Print-only cover sheet at the body root, isolated from the dark app
          chrome — same portal pattern as the desking worksheet. */}
      <style>{`
        @media print {
          body > *:not(#jacket-print-portal) { display: none !important; }
          #jacket-print-portal { display: block !important; }
          @page { margin: 12mm; }
        }
      `}</style>
      {mounted &&
        createPortal(
          <div id="jacket-print-portal" style={{ display: "none" }}>
            <JacketCoverSheet deal={deal} order={order} storeName={storeName} />
          </div>,
          document.body
        )}
    </section>
  );
}

// ── The printed cover sheet ──────────────────────────────────────────────────
// White letter sheet: deal header + the numbered document order with printed
// check states and an initial line per doc. Borders only (no backgrounds), so
// it prints clean even with "Background graphics" off.
function JacketCoverSheet({ deal, order, storeName }: { deal: Deal; order: string[]; storeName: string }) {
  const status = jacketStatus(deal, order);
  const byDoc = new Map(status.items.map((item) => [item.doc, item]));
  const sections = jacketSections(order).map((s) => ({
    name: s.name,
    items: s.docs.map((doc) => byDoc.get(doc)).filter((x): x is (typeof status.items)[number] => !!x),
  }));
  return (
    <div style={{ background: "#fff", color: "#000", fontFamily: "Arial, Helvetica, sans-serif", padding: "6px 2px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "2px solid #000", paddingBottom: 6 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: "0.04em" }}>{storeName.toUpperCase()} — DEAL JACKET</div>
          <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>Documents in required order · initial as filed</div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 700 }}>
          {status.have}/{status.required} filed{status.na ? ` · ${status.na} N/A` : ""}
        </div>
      </div>

      <table style={{ width: "100%", fontSize: 11.5, marginTop: 8, borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <PrintField label="Customer" value={deal.customer} />
            <PrintField label="Deal #" value={deal.dealNumber || "—"} />
            <PrintField label="Date" value={deal.date} />
          </tr>
          <tr>
            <PrintField label="Stock #" value={deal.stockNumber || "—"} />
            <PrintField label="Lender" value={deal.lender || "—"} />
            <PrintField label="F&I" value={displayFullPersonName(canonicalPersonName(deal.financeManager))} />
          </tr>
          <tr>
            <PrintField label="Address" value={deal.customerAddress || "—"} span={2} />
            <PrintField label="VIN" value={deal.vin && deal.vin !== "Pending" ? deal.vin : "—"} />
          </tr>
        </tbody>
      </table>

      <table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={printTh}>#</th>
            <th style={{ ...printTh, textAlign: "left" }}>Document</th>
            <th style={printTh}>Filed</th>
            <th style={printTh}>N/A</th>
            <th style={{ ...printTh, width: 70 }}>Initials</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.name || "order"}>
              {section.name && (
                <tr>
                  <td colSpan={5} style={{ padding: "8px 4px 3px", fontSize: 10.5, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: "1.5px solid #000" }}>
                    {section.name}
                  </td>
                </tr>
              )}
              {section.items.map((item) => (
                <tr key={item.doc}>
                  <td style={{ ...printTd, textAlign: "center", fontWeight: 700, width: 26 }}>{item.position}</td>
                  <td style={{ ...printTd, fontWeight: item.state === "missing" ? 700 : 400 }}>{item.doc}</td>
                  <td style={{ ...printTd, textAlign: "center", width: 44 }}>
                    <PrintBox marked={item.state === "have"} />
                  </td>
                  <td style={{ ...printTd, textAlign: "center", width: 44 }}>
                    <PrintBox marked={item.state === "na"} />
                  </td>
                  <td style={{ ...printTd, width: 70 }} />
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 10, color: "#444" }}>
        <span>F&I signature: ____________________&nbsp;&nbsp;&nbsp;Office received: ____________________</span>
        <span>Printed {new Date().toLocaleDateString("en-US")} · Dealer Mission OS</span>
      </div>
    </div>
  );
}

const printTh: React.CSSProperties = {
  borderBottom: "2px solid #000",
  padding: "4px 6px",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  textAlign: "center",
};
const printTd: React.CSSProperties = {
  borderBottom: "1px solid #bbb",
  padding: "5px 6px",
  fontSize: 11.5,
};

function PrintField({ label, value, span }: { label: string; value: string; span?: number }) {
  return (
    <td colSpan={span} style={{ padding: "3px 6px 3px 0" }}>
      <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "#555" }}>{label}&nbsp;&nbsp;</span>
      <span style={{ fontWeight: 700, borderBottom: "1px solid #999", paddingBottom: 1 }}>{value}</span>
    </td>
  );
}

function PrintBox({ marked }: { marked: boolean }) {
  return (
    <span
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: 13,
        height: 13,
        border: "1.5px solid #000",
        fontSize: 10,
        fontWeight: 900,
        lineHeight: 1,
      }}
    >
      {marked ? "✕" : ""}
    </span>
  );
}
