"use client";

// The window into EILA's memory — "What EILA has learned about you." The durable
// notes she distills after conversations (api/ila/reflect) and carries forward
// to coach you. Readable so you can watch her get dependable over time, and
// correctable — drop anything she got wrong and she stops using it.

import { Brain, X } from "lucide-react";
import { useMission } from "@/lib/store";

function relDate(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function IlaMemoryBlock() {
  const { data, forgetIlaMemory } = useMission();
  const memories = data.ilaMemories ?? [];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65">
          <Brain size={13} className="text-accent2" /> What EILA has learned about you
        </div>
        {memories.length > 0 && <span className="rounded-full bg-fg/6 px-2 py-0.5 text-[11px] font-semibold text-fg/60">{memories.length}</span>}
      </div>

      {memories.length === 0 ? (
        <div className="glass p-4 text-sm text-fg/60">
          EILA is still getting to know you. As you talk with her, she notes the durable things that matter — and you'll watch them show up here.
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map((m) => (
            <div key={m.id} className="glass flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] leading-snug text-fg/90">{m.note}</div>
                <div className="mt-0.5 text-[11px] text-fg/45">learned {relDate(m.date)}</div>
              </div>
              <button
                onClick={() => forgetIlaMemory(m.id)}
                aria-label="Forget this"
                className="shrink-0 rounded-lg p-1.5 text-fg/40 transition hover:bg-fg/5 hover:text-warn"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 text-[11px] leading-snug text-fg/45">
        She uses these to coach you — not transient numbers, just what's durable and true about you. Remove anything wrong and she'll drop it.
      </div>
    </div>
  );
}
