"use client";

// Multi-page pay-plan uploader — shared by Onboarding and Settings.
// Real pay plans run several pages, and phones capture them one photo at a
// time, so this ACCUMULATES pages (add as many as you need, remove misfires)
// and sends them to the parser as one document.

import { useRef, useState } from "react";
import { Upload, Camera, FileText, Loader2, X, Sparkles } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { filesToPayload, FilePart } from "@/lib/payplan/upload";
import { Industry, Role } from "@/lib/types";
import { PayPlan } from "@/lib/payplan/types";

// Keep comfortably under the server's total-content cap (compressed pages
// run ~300KB base64 each, so this allows ~10 photo pages).
const MAX_TOTAL_B64 = 4_000_000;
export const MAX_PAGES = 10;

export interface ParseResult {
  ok: boolean;
  plan?: PayPlan;
  /** Label for what was uploaded, e.g. "payplan.pdf" or "4 pages". */
  sourceName?: string;
  error?: string;
}

export function PayPlanUploader({ role, industry, busyLabel, onResult }: {
  role: Role;
  industry: Industry | null;
  busyLabel?: string;
  onResult: (r: ParseResult) => void;
}) {
  const [pages, setPages] = useState<FilePart[]>([]);
  const [text, setText] = useState<string>();
  const [parsing, setParsing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // same file(s) can be re-picked after a remove
    if (!files.length) return;
    setNote(null);
    try {
      const payload = await filesToPayload(files);
      if (payload.skipped?.length) setNote(`Couldn't read ${payload.skipped.join(", ")} — take the photo with the regular camera app or screenshot the page, then add it again.`);
      if (!payload.text && !payload.files?.length) { if (!payload.skipped?.length) setNote("Couldn't read that format — use a photo, PDF, or text file."); return; }
      if (payload.text) setText((t) => (t ? `${t}\n\n--- next page ---\n\n${payload.text}` : payload.text!).slice(0, 200_000));
      if (payload.files?.length) {
        setPages((p) => {
          const next = [...p, ...payload.files!].slice(0, MAX_PAGES);
          if (p.length + payload.files!.length > MAX_PAGES) setNote(`Max ${MAX_PAGES} pages — extras were dropped.`);
          return next;
        });
      }
    } catch {
      setNote("Couldn't read that file — try taking the photo again.");
    }
  }

  async function parse() {
    if (parsing) return;
    const totalB64 = pages.reduce((n, p) => n + p.dataB64.length, 0) + (text?.length ?? 0);
    if (totalB64 > MAX_TOTAL_B64) { setNote("That's too much at once — remove a page or two and try again."); return; }
    setParsing(true); setNote(null);
    const sourceName = pages.length > 1 ? `${pages.length} pages` : pages[0]?.name || "pay plan";
    try {
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch("/api/parse-payplan", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          role, industry,
          fileName: sourceName,
          ...(text ? { text } : {}),
          ...(pages.length ? { files: pages.map(({ dataB64, mediaType }) => ({ dataB64, mediaType })) } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok && json.plan) onResult({ ok: true, plan: { ...json.plan, role, sourceRef: sourceName }, sourceName });
      else onResult({ ok: false, sourceName, error: json?.error });
    } catch {
      onResult({ ok: false, sourceName });
    } finally {
      setParsing(false);
    }
  }

  const hasInput = pages.length > 0 || !!text;

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,.rtf,.csv,.md,image/*,application/pdf" className="hidden" onChange={onFiles} />

      {pages.length > 0 && (
        <ul className="space-y-1.5">
          {pages.map((p, i) => (
            <li key={i} className="glass flex items-center gap-2 px-3 py-2 text-sm">
              <FileText size={15} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-fg/80">Page {i + 1} · {p.name}</span>
              <button type="button" aria-label={`Remove page ${i + 1}`} onClick={() => setPages((ps) => ps.filter((_, j) => j !== i))}>
                <X size={15} className="text-fg/50" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {text && (
        <div className="glass flex items-center gap-2 px-3 py-2 text-sm">
          <FileText size={15} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-fg/80">Text page{pages.length ? " (sent with the photos)" : ""}</span>
          <button type="button" aria-label="Remove text" onClick={() => setText(undefined)}><X size={15} className="text-fg/50" /></button>
        </div>
      )}

      <button type="button" onClick={() => fileRef.current?.click()} disabled={parsing}
        className="glass glass-tap flex w-full flex-col items-center gap-3 border-dashed py-8">
        {hasInput ? <Camera size={24} className="text-accent" /> : <Upload size={28} className="text-accent" />}
        <span className="text-sm font-semibold">{hasInput ? "Add another page" : "Upload pay plan"}</span>
        <span className="text-xs text-fg/65">{hasInput ? "Snap or pick the next page — get every page in." : "Photos · PDF · Text — multi-page welcome"}</span>
      </button>

      {hasInput && (
        <button type="button" onClick={parse} disabled={parsing} className="btn btn-primary btn-block">
          {parsing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {parsing ? (busyLabel || "Reading your pay plan…") : `Read my pay plan${pages.length > 1 ? ` (${pages.length} pages)` : ""}`}
        </button>
      )}

      {note && <p className="px-1 text-xs text-warn">{note}</p>}
    </div>
  );
}
