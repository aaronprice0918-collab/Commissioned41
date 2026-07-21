"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileScan, Loader2, Printer } from "lucide-react";
import { orderScannedPages, type PageLabel, type ScanSortPlan } from "@/lib/jacketScan";
import { authHeaders } from "@/lib/storeClient";

// SCAN AND SORT — drop the scanned signed-deal PDF on EILA and get it back in
// the store's jacket order. The whole pipeline is ephemeral: the PDF is split
// into pages HERE in the browser (pdf-lib), pages go up ONLY to be labeled,
// and the reordered PDF is rebuilt HERE. Nothing is stored anywhere.

const BATCH_SIZE = 8;

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "classifying"; done: number; total: number }
  | { kind: "done"; plan: ScanSortPlan; url: string; fileName: string; pageCount: number }
  | { kind: "error"; message: string };

export function JacketScanSort({
  order,
  customer,
  dealId,
  onDocsFound,
  onFiled,
}: {
  order: string[];
  customer: string;
  /** When set (with onFiled), the sorted PDF is also FILED to the deal's blue
   * folder — the private 90-day hold (lib/jacketFile.ts). */
  dealId?: string;
  /** Docs EILA saw in the scan — the checklist marks them filed. */
  onDocsFound: (docs: string[]) => void;
  /** The blue-folder ref after a successful filing — parent stores it on the deal. */
  onFiled?: (file: { path: string; pages: number; savedAt: string }) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [filedNote, setFiledNote] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);

  async function handleFile(file: File) {
    try {
      setFiledNote("");
      setPhase({ kind: "reading" });
      const { PDFDocument } = await import("pdf-lib");
      const bytes = await file.arrayBuffer();
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pageCount = src.getPageCount();
      if (!pageCount) throw new Error("That PDF has no pages.");
      if (pageCount > 120) throw new Error("That's over 120 pages — scan one deal at a time.");

      // Split every page into its own tiny PDF (what the classifier reads).
      const pagePdfs: string[] = [];
      for (let i = 0; i < pageCount; i += 1) {
        const one = await PDFDocument.create();
        const [copied] = await one.copyPages(src, [i]);
        one.addPage(copied);
        pagePdfs.push(await one.saveAsBase64());
      }

      // Label pages in batches so requests stay small (scans carry SSNs — they
      // go up once, get labeled, and are gone).
      const labels: PageLabel[] = [];
      setPhase({ kind: "classifying", done: 0, total: pageCount });
      for (let start = 0; start < pageCount; start += BATCH_SIZE) {
        const batch = pagePdfs.slice(start, start + BATCH_SIZE).map((data, j) => ({ page: start + j, data }));
        const res = await fetch("/api/ai/jacket-scan", {
          method: "POST",
          headers: { "content-type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ pages: batch, order }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || "EILA couldn't read those pages — try again.");
        labels.push(...(payload.labels as PageLabel[]));
        setPhase({ kind: "classifying", done: Math.min(start + BATCH_SIZE, pageCount), total: pageCount });
      }

      // Rebuild the PDF in the store's order — every page kept, unknowns last.
      const plan = orderScannedPages(labels, order);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, plan.sequence);
      for (const p of copied) out.addPage(p);
      const outBytes = await out.save();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(new Blob([outBytes as unknown as BlobPart], { type: "application/pdf" }));
      urlRef.current = url;

      const fileName = `${customer.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "deal"}-jacket-sorted.pdf`;
      setPhase({ kind: "done", plan, url, fileName, pageCount });
      if (plan.found.length) onDocsFound(plan.found);

      // File to the blue folder (90-day hold on the deal). A filing failure
      // NEVER blocks the download — the sorted PDF above is already the user's.
      if (dealId && onFiled) {
        setFiledNote("Filing to the blue folder…");
        try {
          const outB64 = await out.saveAsBase64();
          const res = await fetch("/api/jacket-file", {
            method: "POST",
            headers: { "content-type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify({ dealId, pdf: `data:application/pdf;base64,${outB64}`, pages: pageCount }),
          });
          const ref = (await res.json().catch(() => ({}))) as { path?: string; pages?: number; savedAt?: string; error?: string };
          if (res.ok && ref.path && ref.savedAt) {
            onFiled({ path: ref.path, pages: ref.pages ?? pageCount, savedAt: ref.savedAt });
            setFiledNote("Filed to the blue folder on this deal — held 90 days, then EILA lets it go.");
          } else {
            setFiledNote(`Couldn't file it (${ref.error || "storage unavailable"}) — your download above is unaffected.`);
          }
        } catch {
          setFiledNote("Couldn't file it — your download above is unaffected.");
        }
      }
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Scan failed — try again." });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = phase.kind === "reading" || phase.kind === "classifying";

  return (
    <div className="mt-4 rounded-[12px] border border-mission-gold/25 bg-mission-gold/[0.05] p-4">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-mission-gold">
        <FileScan className="h-4 w-4" /> Scan and Sort
      </div>
      <p className="mt-1.5 text-xs leading-5 text-white/50">
        Scan the signed stack in any order, drop the PDF here — EILA puts the pages in the store&apos;s
        jacket order and checks off what she finds.{" "}
        {dealId && onFiled
          ? "The sorted PDF is filed to this deal's blue folder for 90 days, then let go."
          : "Nothing is stored."}
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

      {phase.kind === "idle" || phase.kind === "error" || phase.kind === "done" ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[12px] border border-mission-gold/50 px-3 text-xs font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy"
        >
          <FileScan className="h-4 w-4" /> {phase.kind === "done" ? "Sort another PDF" : "Drop the scanned PDF"}
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
          <Loader2 className="h-4 w-4 animate-spin text-mission-gold" />
          {phase.kind === "reading"
            ? "Reading the PDF…"
            : `EILA is sorting… ${(phase as { done: number }).done}/${(phase as { total: number }).total} pages`}
        </div>
      )}

      {phase.kind === "error" && <p className="mt-2 text-xs font-semibold text-mission-red">{phase.message}</p>}

      {phase.kind === "done" && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-sm font-bold text-mission-green">
            <CheckCircle2 className="h-4 w-4" /> {phase.pageCount} pages sorted into {phase.plan.groups.length} sections
          </div>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-white/60">
            {phase.plan.groups.map((g) => (
              <li key={g.doc} className={g.doc === "Unknown" ? "text-mission-gold" : undefined}>
                {g.doc === "Unknown" ? `⚠ ${g.pages.length} page${g.pages.length === 1 ? "" : "s"} EILA couldn't place — kept at the back` : `${g.doc} · ${g.pages.length} pg`}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <a
              href={phase.url}
              download={phase.fileName}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[12px] bg-mission-gold px-3 text-xs font-black uppercase tracking-[0.12em] text-mission-navy"
            >
              Download sorted PDF
            </a>
            <button
              type="button"
              onClick={() => window.open(phase.url, "_blank", "noopener")}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[12px] border border-white/15 px-3 text-xs font-black uppercase tracking-[0.12em] text-white/70 transition hover:border-mission-gold/50 hover:text-white"
            >
              <Printer className="h-4 w-4" /> Open to print
            </button>
          </div>
          {filedNote && <p className={`mt-2 text-[11px] leading-4 ${filedNote.startsWith("Filed") ? "text-sky-400" : filedNote.startsWith("Filing") ? "text-white/50" : "text-mission-gold"}`}>{filedNote}</p>}
          <p className="mt-2 text-[11px] leading-4 text-white/40">
            Double-check the order before it walks to the office — EILA is sharp, not infallible.
          </p>
        </div>
      )}
    </div>
  );
}
