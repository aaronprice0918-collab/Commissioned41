"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Can I afford a $1,500 truck payment?",
  "How's my emergency fund really doing?",
  "Where's my money going this month?",
  "What should I do with my next commission check?",
];

export function IlaChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: clean }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/ila", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok || !res.body) {
        const errText = (await res.text().catch(() => "")) || "EILA couldn't respond.";
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: errText };
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
      setBusy(false);
    }
  }

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full border border-white/15 bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_40px_-8px_rgba(59,130,246,0.6)] transition hover:bg-[var(--accent-soft)]"
        style={{ display: open ? "none" : undefined }}
        aria-label="Ask EILA"
      >
        <IlaMark />
        Ask EILA
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="glass relative flex h-full w-full max-w-md flex-col rounded-none border-y-0 border-r-0 sm:m-3 sm:h-[calc(100%-1.5rem)] sm:rounded-[var(--radius)] sm:border">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-soft)]">
                  <IlaMark />
                </div>
                <div>
                  <div className="text-sm font-semibold">EILA</div>
                  <div className="text-[11px] text-[var(--text-faint)]">your CFO · knows your numbers</div>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-dim)] transition hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="rounded-2xl rounded-tl-sm border border-white/8 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-[var(--text)]">
                    I&apos;ve got eyes on every dollar you have. Ask me anything — what you can spend, where your
                    money&apos;s leaking, or whether that purchase is worth it. Straight answers only.
                  </div>
                  <div className="space-y-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="block w-full rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2.5 text-left text-sm text-[var(--text-dim)] transition hover:border-white/20 hover:text-white"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-tr-sm bg-[var(--accent)] px-4 py-2.5 text-sm leading-relaxed text-white"
                        : "max-w-[90%] rounded-2xl rounded-tl-sm border border-white/8 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-[var(--text)]"
                    }
                  >
                    {m.content || (m.role === "assistant" && busy ? <Typing /> : "")}
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="border-t border-white/8 p-3"
            >
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask EILA about your money…"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-faint)]"
                  disabled={busy}
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-white transition hover:bg-[var(--accent-soft)] disabled:opacity-40"
                  aria-label="Send"
                >
                  ↑
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function IlaMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect x="2" y="2" width="44" height="44" rx="10" fill="#F1F5FF" />
      <rect x="10" y="8" width="7" height="32" rx="1.2" fill="#3567D6" />
      <rect x="10" y="8" width="28" height="7" rx="1.2" fill="#3567D6" />
      <rect x="10" y="20.5" width="23" height="7" rx="1.2" fill="#3567D6" />
      <rect x="10" y="33" width="28" height="7" rx="1.2" fill="#3567D6" />
    </svg>
  );
}

function Typing() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-faint)] [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-faint)] [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-faint)]" />
    </span>
  );
}
