"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, Pin, PinOff, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { useAuth } from "@/components/AuthProvider";
import { authHeaders } from "@/lib/storeClient";

// EILA's Brain — owner-only. Every universal lesson she's taught herself
// across ALL Commissioned 41 products, each with its field record (how often
// she applied it, how often it landed), her self-written learning digest, and
// Aaron's curation controls: pin the keepers, delete the duds.

type Lesson = {
  lesson: string;
  source: string;
  date: string;
  uses?: number;
  wins?: number;
  pinned?: boolean;
};

const SOURCE_LABEL: Record<string, string> = {
  dealer: "Dealer Mission OS",
  lite: "EILA",
  finance: "MissionOS Finance",
};

export default function IlaBrainPage() {
  const { isOwner } = useAuth();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [digest, setDigest] = useState("");
  const [digesting, setDigesting] = useState(false);
  const [busyLesson, setBusyLesson] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ila-brain", { headers: { ...(await authHeaders()) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load her brain.");
      setLessons(Array.isArray(data.lessons) ? data.lessons : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  async function runDigest() {
    if (digesting) return;
    setDigesting(true);
    setDigest("");
    try {
      const res = await fetch("/api/ila-brain", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ op: "digest" }),
      });
      const data = await res.json().catch(() => ({}));
      setDigest(res.ok ? data.digest : data.error || "Digest failed.");
    } catch {
      setDigest("Digest failed — try again.");
    } finally {
      setDigesting(false);
    }
  }

  async function curate(lesson: Lesson, op: "pin" | "unpin" | "delete") {
    if (busyLesson) return;
    if (op === "delete" && !window.confirm("Delete this lesson from EILA's brain everywhere?")) return;
    setBusyLesson(lesson.lesson);
    try {
      const res = await fetch("/api/ila-brain", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ op, lesson: lesson.lesson }),
      });
      if (res.ok) await load();
    } finally {
      setBusyLesson(null);
    }
  }

  if (!isOwner) {
    return (
      <div>
        <SectionHeader title="EILA's Brain" kicker="Her shared playbook" icon={Brain} />
        <div className="rounded-[12px] border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/60">This is private to the owner.</div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="EILA's Brain" kicker="Every lesson she's taught herself, across all three products" icon={Brain} />

      {/* her self-written learning digest */}
      <section className="rise glass-card mb-5 rounded-[14px] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="font-display text-lg font-black text-white">What I&apos;ve Learned</div>
            <span className="live-dot h-2 w-2 rounded-full bg-mission-green" aria-hidden />
          </div>
          <button
            onClick={runDigest}
            disabled={digesting}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/[0.12] disabled:opacity-50"
          >
            {digesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {digesting ? "EILA is reviewing her growth…" : digest ? "Refresh briefing" : "Ask EILA for her briefing"}
          </button>
        </div>
        {digest ? (
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-white/85">{digest}</p>
        ) : (
          <p className="text-sm text-white/45">
            Her own report on what she&apos;s taught herself lately — what&apos;s new, what&apos;s proving out in the field, and what she&apos;s cutting.
          </p>
        )}
      </section>

      {/* the playbook, ranked exactly as she reads it */}
      <section className="rise glass-card rounded-[14px] p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="font-display text-lg font-black text-white">
            The Playbook <span className="ml-1 text-sm font-semibold text-white/40">{lessons.length} lessons</span>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            aria-label="Reload"
            className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-white/70 transition hover:bg-white/[0.12] disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>

        {error && <div className="mb-3 rounded-[10px] border border-mission-red/30 bg-mission-red/10 p-3 text-sm text-mission-red">{error}</div>}

        {!loading && lessons.length === 0 && !error && (
          <div className="p-6 text-center text-sm text-white/50">Empty — she hasn&apos;t distilled any universal lessons yet.</div>
        )}

        <ul className="space-y-2.5">
          {lessons.map((l) => {
            const uses = l.uses ?? 0;
            const wins = l.wins ?? 0;
            const busy = busyLesson === l.lesson;
            return (
              <li key={l.lesson} className="rounded-[12px] border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[15px] leading-relaxed text-white/90">{l.lesson}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                  {l.pinned && (
                    <span className="rounded-full bg-mission-gold/20 px-2.5 py-0.5 font-semibold uppercase tracking-wide text-mission-gold">Pinned</span>
                  )}
                  <span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-white/55">{SOURCE_LABEL[l.source] || l.source}</span>
                  <span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-white/55">learned {l.date?.slice(0, 10)}</span>
                  <span className={`rounded-full px-2.5 py-0.5 font-semibold ${uses === 0 ? "bg-white/[0.07] text-white/45" : wins / uses >= 0.5 ? "bg-mission-green/15 text-mission-green" : "bg-mission-gold/15 text-mission-gold"}`}>
                    {uses === 0 ? "not field-tested yet" : `applied ${uses}× · landed ${wins}×`}
                  </span>
                  <span className="flex-1" />
                  <button
                    onClick={() => void curate(l, l.pinned ? "unpin" : "pin")}
                    disabled={busy}
                    aria-label={l.pinned ? "Unpin lesson" : "Pin lesson"}
                    className="grid h-7 w-7 place-items-center rounded-full border border-white/15 bg-white/[0.05] text-white/60 transition hover:bg-white/[0.12] disabled:opacity-40"
                  >
                    {l.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                  </button>
                  <button
                    onClick={() => void curate(l, "delete")}
                    disabled={busy}
                    aria-label="Delete lesson"
                    className="grid h-7 w-7 place-items-center rounded-full border border-mission-red/25 bg-mission-red/10 text-mission-red/80 transition hover:bg-mission-red/20 disabled:opacity-40"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
