"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ScanLine, X, Camera, Loader2, ShieldCheck } from "lucide-react";
import { authHeaders } from "@/lib/storeClient";

export type LicenseFields = Record<string, string>;

type Mode = "license" | "insurance";

const MODES: Record<Mode, { title: string; endpoint: string; heading: string; hint: ReactNode; icon: typeof Camera }> = {
  license: {
    title: "Scan driver's license",
    endpoint: "/api/ai/license-scan",
    heading: "Photograph the license",
    icon: Camera,
    hint: (
      <>Snap the <span className="font-bold text-white">front</span> — the side with the photo. Flat, well-lit, filling the frame. EILA reads the rest.</>
    ),
  },
  insurance: {
    title: "Scan insurance card",
    endpoint: "/api/ai/insurance-scan",
    heading: "Photograph the insurance card",
    icon: ShieldCheck,
    hint: (
      <>Snap the <span className="font-bold text-white">front</span> of the card — carrier, policy number and dates in frame. EILA reads the rest.</>
    ),
  },
};

// EILA reads a photo of a document (the FRONT of a driver's license or an
// insurance card) with her vision and fills the deal — no barcode, no SDK. The
// photo is downscaled client-side so the upload + read stay fast and cheap, and
// the same captured image is handed back so the deal can keep it on file.
export function DocScanner({
  mode,
  onResult,
  onClose,
}: {
  mode: Mode;
  onResult: (fields: LicenseFields, image: string) => void;
  onClose: () => void;
}) {
  const cfg = MODES[mode];
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Portal to <body> so the scanner sits ABOVE the app shell (header, EILA orb).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function onPhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // let the same file be picked again
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const image = await fileToScaledDataUrl(file);
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ image }),
      });
      const data = (await res.json().catch(() => ({}))) as { fields?: LicenseFields; error?: string };
      if (!res.ok || !data.fields) {
        setErr(data.error || "EILA couldn't read that one — retake it, flat and well-lit.");
        return;
      }
      onResultRef.current(data.fields, image);
    } catch {
      setErr("Couldn't reach EILA to read it — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const Icon = cfg.icon;
  const ui = (
    <div style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)", paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }} className="fixed inset-0 z-[120] flex flex-col bg-[#04060c]" role="dialog" aria-modal="true" aria-label={cfg.title}>
      <div className="flex items-center justify-between gap-3 px-5">
        <div className="flex items-center gap-2 text-mission-green">
          <ScanLine className="h-5 w-5" />
          <span className="font-display text-lg font-black text-white">{cfg.title}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full border border-white/12 text-white/70 transition hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="living-border relative grid h-24 w-24 place-items-center overflow-hidden rounded-[24px] bg-[#08141f]">
          {busy ? <Loader2 className="h-9 w-9 animate-spin text-mission-green" /> : <Icon className="h-10 w-10 text-mission-green" />}
        </div>
        <div>
          <div className="font-display text-2xl font-black text-white">{busy ? "EILA is reading it…" : cfg.heading}</div>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-white/60">
            {busy ? "One sec — pulling the details." : cfg.hint}
          </p>
        </div>
        {err && <p className="max-w-xs text-sm font-semibold leading-5 text-mission-red">{err}</p>}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoSelected} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-full bg-mission-green px-6 py-4 text-base font-black uppercase tracking-[0.1em] text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-60">
          {busy ? <><Loader2 className="h-5 w-5 animate-spin" /> Reading…</> : <><Camera className="h-5 w-5" /> Take a photo</>}
        </button>
        <button type="button" onClick={onClose} className="text-xs font-black uppercase tracking-[0.12em] text-white/45 transition hover:text-white">Enter by hand instead</button>
      </div>
    </div>
  );

  return mounted ? createPortal(ui, document.body) : null;
}

// Back-compat named wrappers so call sites read clearly.
export function LicenseScanner(props: { onResult: (fields: LicenseFields, image: string) => void; onClose: () => void }) {
  return <DocScanner mode="license" {...props} />;
}

export function InsuranceScanner(props: { onResult: (fields: LicenseFields, image: string) => void; onClose: () => void }) {
  return <DocScanner mode="insurance" {...props} />;
}

// Downscale a captured photo so the upload + vision read stay fast and cheap.
async function fileToScaledDataUrl(file: File, maxDim = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = url;
    });
    const longest = Math.max(img.width || maxDim, img.height || maxDim);
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round((img.width || maxDim) * scale));
    const h = Math.max(1, Math.round((img.height || maxDim) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
