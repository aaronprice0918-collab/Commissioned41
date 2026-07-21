"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { getSupabase } from "@/lib/supabase";

interface Msg { role: "user" | "assistant"; content: string }

const SUGGESTIONS = [
  "How are we doing this week?",
  "Who should I check on?",
  "What's our growth trend?",
];

// Aaron's own assistant, right on his Owner page — not the customer chat
// sheet, a permanent panel. Talk-only (no tools) by design: see lib/ila-owner.ts.
export function OwnerIlaChat({ name }: { name: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: clean }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    const watchdog = new AbortController();
    const watchdogTimer = setTimeout(() => watchdog.abort(), 60_000);
    try {
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
      const res = await fetch("/api/owner/ila", {
        method: "POST",
        signal: watchdog.signal,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: next, name }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: err.error || "Couldn't respond — try again." };
          return copy;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: "Couldn't reach EILA. Check your connection and try again." };
        return copy;
      });
    } finally {
      clearTimeout(watchdogTimer);
      setBusy(false);
    }
  }

  return (
    <div className="glass living-ring flex flex-col p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-accent2">
        <Sparkles size={13} /> Your EILA
      </div>

      <div ref={scrollRef} className="mt-3 max-h-[46vh] min-h-[80px] flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="space-y-2.5">
            <div className="rounded-2xl rounded-tl-sm bg-fg/5 px-4 py-3 text-sm leading-relaxed text-fg/80">
              This is just us — I&apos;m watching the business, not any one rep&apos;s month. Ask me how things are going.
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="rounded-full border border-fg/10 bg-fg/[0.03] px-3.5 py-2 text-left text-[13px] text-fg/60 transition active:scale-[0.97]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={m.role === "user"
              ? "max-w-[85%] rounded-2xl rounded-tr-sm bg-accent px-4 py-2.5 text-sm leading-relaxed text-white"
              : "max-w-[92%] rounded-2xl rounded-tl-sm bg-fg/5 px-4 py-3 text-sm leading-relaxed text-fg/85"}>
              {m.content || (m.role === "assistant" && busy ? <Typing /> : "")}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="mt-3 flex items-center gap-2 rounded-2xl border border-fg/10 bg-ink-700 px-3 py-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about the business…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg/60" disabled={busy} />
        <button type="submit" disabled={busy || !input.trim()}
          className="btn-primary grid h-8 w-8 place-items-center rounded-full disabled:opacity-40" aria-label="Send">
          <Sparkles size={15} />
        </button>
      </form>
    </div>
  );
}

function Typing() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg/40 [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg/40 [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg/40" />
    </span>
  );
}
