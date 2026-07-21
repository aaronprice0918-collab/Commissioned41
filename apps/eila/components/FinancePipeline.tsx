"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Clock, FileScan, TableProperties } from "lucide-react";
import clsx from "clsx";
import { useMission } from "@/lib/store";
import { Deal, DealStatus, Industry, STATUS_LABEL } from "@/lib/types";
import { statusLabel } from "@/lib/industry";
import { SectionTitle } from "./ui";
import { LoggImport } from "./LoggImport";

// Stages a finance manager actively works — paperwork submitted, waiting on
// bank approval. Delivered-but-unfunded deals get their own section even
// though they've left the sales pipeline: the unit's gone, the money isn't
// back yet, and that's the thing finance actually loses sleep over.
const FINANCE_STAGES: DealStatus[] = ["pending", "finance"];

export function FinancePipeline() {
  const { data, updateDeal } = useMission();
  const industry: Industry = data.profile?.industry ?? "other";
  const [importOpen, setImportOpen] = useState(false);

  const groups = useMemo(() => {
    const working = data.deals.filter((d) => FINANCE_STAGES.includes(d.status));
    const unfunded = data.deals.filter((d) => d.status === "delivered" && d.funded === false);
    return { working, unfunded };
  }, [data.deals]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 px-1">
        <div>
          <div className="text-xl font-black">Finance queue</div>
          <div className="text-xs text-fg/65">{groups.working.length} in structuring · {groups.unfunded.length} waiting on funding</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Import from THE LOGG — bring the month's spreadsheet in, per deal */}
          <button onClick={() => setImportOpen(true)} className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-accent transition active:scale-95">
            <TableProperties size={14} /> Import LOGG
          </button>
          {/* Scan and Sort — the signed stack back in your jacket order */}
          <Link href="/jacket" className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-accent2 transition active:scale-95">
            <FileScan size={14} /> Scan and Sort
          </Link>
        </div>
      </div>

      <LoggImport open={importOpen} onClose={() => setImportOpen(false)} />

      {groups.unfunded.length > 0 && (
        <>
          <SectionTitle><span className="flex items-center gap-1.5 text-warn"><Clock size={13} /> Waiting on funding</span></SectionTitle>
          <div className="space-y-2">
            {groups.unfunded.map((d) => (
              <FinanceCard key={d.id} d={d} industry={industry}
                onToggleFunded={(v) => updateDeal(d.id, { funded: v })}
                onNote={(n) => updateDeal(d.id, { note: n || undefined })} />
            ))}
          </div>
        </>
      )}

      <SectionTitle>In structuring</SectionTitle>
      {groups.working.length > 0 ? (
        <div className="space-y-2">
          {groups.working.map((d) => (
            <FinanceCard key={d.id} d={d} industry={industry}
              onToggleFunded={(v) => updateDeal(d.id, { funded: v })}
              onNote={(n) => updateDeal(d.id, { note: n || undefined })} />
          ))}
        </div>
      ) : (
        <div className="glass p-8 text-center text-sm text-fg/50">Nothing in pending or finance right now.</div>
      )}
    </div>
  );
}

function FinanceCard({ d, industry, onToggleFunded, onNote }: {
  d: Deal; industry: Industry; onToggleFunded: (v: boolean) => void; onNote: (v: string) => void;
}) {
  const [note, setNote] = useState(d.note ?? "");
  // Resync when the note changes ELSEWHERE (EILA's update_deal, a cloud pull) —
  // a mount-time snapshot here would write the stale copy back on blur, the
  // same clobber class fixed everywhere else (July 8 audit). If the user is
  // mid-edit (local differs from what they started from), their typing wins.
  const seen = useRef(d.note ?? "");
  if ((d.note ?? "") !== seen.current) {
    const external = d.note ?? "";
    if (note === seen.current) setNote(external); // untouched draft → adopt
    seen.current = external;
  }

  return (
    <div className="glass p-3.5">
      <Link href={`/deal/${d.id}`} className="flex items-center gap-3 active:opacity-70">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{d.customer || "New opportunity"}</div>
          <div className="truncate text-xs text-fg/70">{d.item || "—"}{d.bank ? ` · ${d.bank}` : ""}</div>
        </div>
        <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent">
          {statusLabel(industry, d.status, STATUS_LABEL[d.status])}
        </span>
        <ChevronRight size={16} className="shrink-0 text-fg/40" />
      </Link>

      <div className="mt-3 flex items-center gap-2">
        {([["yes", "Funded"], ["no", "Waiting"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => onToggleFunded(v === "yes")}
            className={clsx("flex-1 rounded-xl px-3 py-2 text-[13px] font-semibold transition active:scale-95",
              (d.funded !== false) === (v === "yes") ? "bg-accent text-white" : "bg-fg/6 text-fg/60")}>
            {l}
          </button>
        ))}
      </div>

      <textarea
        className="field mt-2 min-h-[54px] text-[13px]"
        value={note}
        placeholder="Notes on this deal — stips needed, who to call…"
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => { if (note.trim() !== (d.note ?? "")) onNote(note.trim()); }}
      />
    </div>
  );
}
