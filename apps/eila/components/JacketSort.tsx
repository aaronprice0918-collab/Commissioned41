"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileScan, Loader2, Pencil, Printer } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { useMission } from "@/lib/store";
import { jacketOrderFor, normalizeJacketOrder, orderScannedPages, type PageLabel, type ScanSortPlan } from "@/lib/jacket";
import { JACKET_RETENTION_DAYS, uploadJacketFile } from "@/lib/jacketFile";

// SCAN AND SORT — the F&I closer's ritual: scan the signed stack in ANY order,
// drop the PDF on EILA, get it back in YOUR jacket order, print, walk it to
// the office. Everything is ephemeral: the PDF is split into pages HERE in the
// browser (pdf-lib), pages go up ONLY to be labeled, and the reordered PDF is
// rebuilt HERE. Nothing is stored anywhere.

const BATCH_SIZE = 8;

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "classifying"; done: number; total: number }
  | { kind: "done"; plan: ScanSortPlan; url: string; pageCount: number; filed: boolean; filedError?: string }
  | { kind: "error"; message: string };

// When a deal rides in (from its deal card), the sorted PDF is named for the
// customer AND filed on the deal for 90 days — the blue folder.
export function JacketSort({ deal }: { deal?: { id: string; customer: string; dealNumber?: string } }) {
  const { data, account, updateDeal, updateJacketOrder } = useMission();
  const order = jacketOrderFor(data.profile);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);

  function startEdit() {
    setDraft(order.join("\n"));
    setEditing(true);
  }
  function saveEdit() {
    const next = normalizeJacketOrder(draft);
    if (!next.length) return;
    updateJacketOrder(next);
    setEditing(false);
  }

  async function handleFile(file: File) {
    try {
      setPhase({ kind: "reading" });
      const { PDFDocument } = await import("pdf-lib");
      const bytes = await file.arrayBuffer();
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pageCount = src.getPageCount();
      if (!pageCount) throw new Error("That PDF has no pages.");
      if (pageCount > 120) throw new Error("That's over 120 pages — scan one deal at a time.");

      const pagePdfs: string[] = [];
      for (let i = 0; i < pageCount; i += 1) {
        const one = await PDFDocument.create();
        const [copied] = await one.copyPages(src, [i]);
        one.addPage(copied);
        pagePdfs.push(await one.saveAsBase64());
      }

      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;

      const labels: PageLabel[] = [];
      setPhase({ kind: "classifying", done: 0, total: pageCount });
      for (let start = 0; start < pageCount; start += BATCH_SIZE) {
        const batch = pagePdfs.slice(start, start + BATCH_SIZE).map((data2, j) => ({ page: start + j, data: data2 }));
        const res = await fetch("/api/scan-jacket", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ pages: batch, order }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || "EILA couldn't read those pages — try again.");
        labels.push(...(payload.labels as PageLabel[]));
        setPhase({ kind: "classifying", done: Math.min(start + BATCH_SIZE, pageCount), total: pageCount });
      }

      const plan = orderScannedPages(labels, order);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, plan.sequence);
      for (const p of copied) out.addPage(p);
      const outBytes = await out.save();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(new Blob([outBytes as unknown as BlobPart], { type: "application/pdf" }));
      urlRef.current = url;

      // Bound to a deal: file the sorted PDF on the card (blue folder, 90 days).
      // A filing failure never blocks the download — the PDF is already local.
      let filed = false;
      let filedError: string | undefined;
      if (deal && account) {
        try {
          const ref = await uploadJacketFile(account.id, deal.id, outBytes, pageCount);
          updateDeal(deal.id, { jacketFile: ref });
          filed = true;
        } catch (err) {
          filedError = err instanceof Error ? err.message : "Couldn't file the PDF on the deal.";
        }
      }
      setPhase({ kind: "done", plan, url, pageCount, filed, filedError });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Scan failed — try again." });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = phase.kind === "reading" || phase.kind === "classifying";

  return (
    <div className="space-y-4">
      {/* The drop zone */}
      <section className="glass rise p-5">
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-accent2">
          <FileScan size={16} /> Scan and Sort
        </div>
        {deal && (
          <div className="mt-1 text-sm font-bold text-fg/80">
            {deal.customer}
            {deal.dealNumber ? <span className="text-fg/45"> · #{deal.dealNumber}</span> : null}
          </div>
        )}
        <p className="mt-2 text-sm leading-6 text-fg/60">
          Scan the signed stack in any order and drop the PDF here. EILA puts every page in your
          jacket order — download, print, walk it to the office.
          {deal
            ? ` She files a copy on this deal's card (the blue folder) for ${JACKET_RETENTION_DAYS} days, then lets it go.`
            : " Nothing is stored."}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        {busy ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-fg/70">
            <Loader2 size={16} className="animate-spin text-accent2" />
            {phase.kind === "reading"
              ? "Reading the PDF…"
              : `EILA is sorting… ${(phase as { done: number }).done}/${(phase as { total: number }).total} pages`}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn-primary mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-black uppercase tracking-[0.1em]"
          >
            <FileScan size={17} /> {phase.kind === "done" ? "Sort another PDF" : "Drop the scanned PDF"}
          </button>
        )}

        {phase.kind === "error" && <p className="mt-3 text-sm font-semibold text-red-400">{phase.message}</p>}

        {phase.kind === "done" && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
              <CheckCircle2 size={16} /> {phase.pageCount} pages sorted into {phase.plan.groups.length} sections
            </div>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-fg/60">
              {phase.plan.groups.map((g) => (
                <li key={g.doc} className={g.doc === "Unknown" ? "text-accent2" : undefined}>
                  {g.doc === "Unknown"
                    ? `⚠ ${g.pages.length} page${g.pages.length === 1 ? "" : "s"} EILA couldn't place — kept at the back`
                    : `${g.doc} · ${g.pages.length} pg`}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <a
                href={phase.url}
                download={`${(deal?.customer || "deal").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-jacket-sorted.pdf`}
                className="btn-primary inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-black uppercase tracking-[0.1em]"
              >
                Download sorted PDF
              </a>
              <button
                type="button"
                onClick={() => window.open(phase.url, "_blank", "noopener")}
                className="glass inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-bold text-fg/80 transition active:scale-95"
              >
                <Printer size={16} /> Print
              </button>
            </div>
            {phase.filed && (
              <p className="mt-2 text-xs font-semibold text-accent2">
                Filed on the deal card — the blue folder holds it for {JACKET_RETENTION_DAYS} days. Save the download to
                your own drive if you want it forever.
              </p>
            )}
            {phase.filedError && <p className="mt-2 text-xs font-semibold text-red-400">{phase.filedError} The download above still has everything.</p>}
            <p className="mt-2 text-[11px] leading-4 text-fg/40">
              Double-check the order before it walks to the office — EILA is sharp, not infallible.
            </p>
          </div>
        )}
      </section>

      {/* The user's jacket order — theirs to shape, one line per document */}
      <section className="glass rise p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-fg/50">Your jacket order</div>
          {!editing && (
            <button type="button" onClick={startEdit} className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent2 active:opacity-70">
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="mt-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(18, Math.max(8, draft.split("\n").length + 1))}
              className="w-full rounded-[14px] border border-fg/15 bg-black/20 px-3 py-2 text-sm leading-6 text-fg outline-none focus:border-accent2/60"
              aria-label="Your deal-jacket document order, one document per line"
            />
            <p className="mt-1 text-[11px] text-fg/40">One document per line, in the exact stack order your office wants.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={saveEdit} className="btn-primary min-h-10 flex-1 rounded-[14px] px-3 text-xs font-black uppercase tracking-[0.1em]">
                Save order
              </button>
              <button type="button" onClick={() => setEditing(false)} className="glass min-h-10 flex-1 rounded-[14px] px-3 text-xs font-black uppercase tracking-[0.1em] text-fg/70">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {order.map((doc, i) => (
              <li key={doc} className="flex items-center gap-3 rounded-[12px] border border-fg/10 bg-black/10 px-3 py-2 text-sm text-fg/75">
                <span className="w-5 shrink-0 text-right text-xs font-black tabular-nums text-fg/35">{i + 1}</span>
                {doc}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
