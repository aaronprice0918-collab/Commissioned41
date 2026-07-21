"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Sparkles, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { useMission } from "@/lib/store";
import type { Deal, Profile } from "@/lib/types";

const THINKING_STATES = [
  "EILA is setting up your welcome…",
  "EILA is checking your day…",
  "EILA is finding the simplest next step…",
];

/** The emotional anchor of the dashboard — a live, EILA-generated morning
 * welcome grounded in the rep's real goal pace, pipeline, and day.
 * Reuses the same /api/ila route as the chat sheet, just with a kickoff
 * prompt instead of a typed question. A missing greeting should never block
 * the rest of the dashboard from rendering. */
export function IlaGreeting({ profile, deals }: { profile: Profile; deals: Deal[] }) {
  const { data } = useMission();
  const [text, setText] = useState("");
  const [state, setState] = useState<"loading" | "done" | "error" | "skip">("loading");
  const [attempt, setAttempt] = useState(0);
  const [thinkingIdx, setThinkingIdx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const started = useRef(false);
  // snapshot her memory at mount — the briefing fires once, and we don't want
  // the effect re-running when a reflection lands mid-stream
  const memoriesRef = useRef(data.ilaMemories ?? []);

  useEffect(() => {
    const id = setInterval(() => setThinkingIdx((i) => (i + 1) % THINKING_STATES.length), 1800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const sb = getSupabase();
        const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
        if (!token) {
          setState("skip");
          return;
        }

        const nowLabel = new Date().toLocaleString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });

        const res = await fetch("/api/ila", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            messages: [{ role: "user", content: `Give me my dashboard welcome for ${nowLabel} — warm, positive, clear, and useful. Tell me where I stand, what is already working, and the first simple move without making it feel heavy. Do not call it morning unless it is actually morning.` }],
            profile,
            plan: profile.plan,
            deals,
            memories: memoriesRef.current,
          }),
        });

        if (!res.ok || !res.body) {
          setState("error");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
        setState(acc.trim() ? "done" : "error");
      } catch {
        setState("error");
      }
    })();
  }, [profile, deals, attempt]);

  if (state === "skip") return null;

  // The briefing is the emotional anchor of the dashboard — when it can't
  // load, it says so and offers a retry instead of silently vanishing
  // (silence sweep, July 13).
  if (state === "error") {
    return (
      <button
        onClick={() => { started.current = false; setState("loading"); setText(""); setAttempt((a) => a + 1); }}
        className="glass rise block w-full p-4 text-left transition active:scale-[0.99]"
      >
        <span className="text-[13px] text-fg/70">EILA couldn&apos;t load your briefing just now — </span>
        <span className="text-[13px] font-semibold text-accent">tap to try again</span>
      </button>
    );
  }

  return (
    <>
      {/* Collapsed teaser — the briefing never swallows the dashboard.
          First lines only; Read more opens the full-screen reader. */}
      <button
        onClick={() => text && setExpanded(true)}
        className="glass living-ring rise block w-full p-4 text-left transition active:scale-[0.99]"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-accent2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent2 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent2" />
            </span>
            EILA
          </div>
          {text && (
            <span className="flex items-center gap-0.5 text-[11px] font-semibold text-accent">
              Read more <ChevronRight size={13} />
            </span>
          )}
        </div>
        {state === "loading" && !text ? (
          <div className="mt-2 flex items-center gap-2 text-[15px] text-fg/70">
            <Sparkles size={14} className="animate-pulse text-accent2" />
            {THINKING_STATES[thinkingIdx]}
          </div>
        ) : (
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-[15px] leading-relaxed text-fg/90">{text}</p>
        )}
      </button>

      {/* Full-screen reader — big type, breathing room, one tap back to work */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink-900/[0.97] backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-app flex-1 flex-col overflow-hidden px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-[max(env(safe-area-inset-top),20px)]">
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent2 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent2" />
                </span>
                EILA · your welcome
              </div>
              <button onClick={() => setExpanded(false)} aria-label="Close"
                className="grid h-10 w-10 place-items-center rounded-full bg-fg/8 text-fg/70 active:scale-95">
                <X size={18} />
              </button>
            </div>
            <div className="rise flex-1 overflow-y-auto py-4">
              <p className="whitespace-pre-line text-[19px] leading-[1.75] text-fg/95">{text}</p>
            </div>
            <button onClick={() => setExpanded(false)} className="btn btn-primary btn-block mt-2">
              Got it — let&apos;s work
            </button>
          </div>
        </div>
      )}
    </>
  );
}
