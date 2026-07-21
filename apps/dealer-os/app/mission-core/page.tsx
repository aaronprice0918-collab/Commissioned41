"use client";

import { useEffect, useRef, useState } from "react";
import { Compass, Mic, Send, Sparkles, Target, Volume2, VolumeX } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { MissionWordmark } from "@/components/BrandMarks";
import { useAuth } from "@/components/AuthProvider";
import { authHeaders, loadStore } from "@/lib/storeClient";
import { useVoice } from "@/lib/voice";

type Msg = { role: "user" | "assistant"; content: string };
type Goal = { id: string; title: string; horizon?: string; area?: string; status?: string; due?: string };
type MissionState = { northStar?: string; goals?: Goal[]; priorities?: { id: string; title: string }[] };

const QUICK = [
  "Give me my briefing",
  "What should I focus on today?",
  "Help me make a decision",
  "Where am I off track?",
];

const HORIZON_ORDER = ["day", "week", "month", "quarter", "annual"];
const HORIZON_LABEL: Record<string, string> = {
  day: "Today", week: "This Week", month: "This Month", quarter: "This Quarter", annual: "This Year",
};

export default function MissionCorePage() {
  const { isOwner } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "MissionOS online. I run your life like an operating system — faith, family, health, finances, and business. Ask me anything, or tap \"Give me my briefing\" to start." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [state, setState] = useState<MissionState>({});
  const endRef = useRef<HTMLDivElement>(null);

  const { listening, speaking, inputSupported, outputSupported, startListening, stopListening, speak, stopSpeaking } =
    useVoice({ onInterim: (t) => setInput(t), onFinal: (t) => { setInput(""); void send(t); } });

  async function refreshState() {
    const s = await loadStore<MissionState>("missionCore");
    if (s && typeof s === "object") setState(s);
  }

  useEffect(() => { if (isOwner) void refreshState(); }, [isOwner]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function callCore(payload: Record<string, unknown>) {
    const res = await fetch("/api/ai/core", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload),
    });
    return res.json().catch(() => ({}));
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || loading) return;
    const isBrief = /give me my briefing/i.test(text);
    const current = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    try {
      const history = current[0]?.role === "assistant" ? current.slice(1) : current;
      const data = isBrief
        ? await callCore({ action: "briefing" })
        : await callCore({ action: "chat", message: text, history });
      const reply = data.reply || data.error || "Lost the connection. Try again.";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (voiceOn && data.reply) speak(reply);
      void refreshState();
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network issue. Try again." }]);
    } finally {
      setLoading(false);
    }
  }

  if (!isOwner) {
    return (
      <div>
        <SectionHeader title="MissionOS Core" kicker="Your private executive operating system" icon={Compass} />
        <div className="rounded-[12px] border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/60">
          MissionOS Core is private to the owner.
        </div>
      </div>
    );
  }

  const goals = Array.isArray(state.goals) ? state.goals.filter((g) => g.status !== "done") : [];
  const grouped = HORIZON_ORDER
    .map((h) => ({ h, items: goals.filter((g) => (g.horizon || "month") === h) }))
    .filter((g) => g.items.length);

  return (
    <div>
      <SectionHeader title="MissionOS Core" kicker="Think · Decide · Execute · Automate · Win" icon={Compass} />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* ── Conversation ── */}
        <main className="glass-card flex min-h-[64vh] flex-col rounded-[16px]">
          <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-mission-gold via-mission-green to-mission-gold/40 text-mission-navy">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <MissionWordmark className="text-base" />
              <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${listening ? "text-mission-red" : speaking ? "text-mission-gold" : "text-mission-green"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${listening ? "bg-mission-red" : speaking ? "bg-mission-gold" : "bg-mission-green"}`} />
                {listening ? "Listening…" : speaking ? "Speaking…" : "Online"}
              </div>
            </div>
            {outputSupported && (
              <button
                type="button"
                onClick={() => { const n = !voiceOn; setVoiceOn(n); if (!n) stopSpeaking(); }}
                aria-label={voiceOn ? "Mute voice" : "Unmute voice"}
                title={voiceOn ? "Voice on" : "Voice off"}
                className={`grid h-8 w-8 place-items-center rounded-full transition ${voiceOn ? "bg-mission-gold/20 text-mission-gold" : "text-white/35 hover:text-white/70"}`}
              >
                {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[82%] rounded-[16px] rounded-br-sm bg-mission-gold px-3.5 py-2 text-sm font-medium text-mission-navy"
                      : "max-w-[88%] whitespace-pre-wrap rounded-[16px] rounded-bl-sm border border-white/8 bg-white/[0.05] px-3.5 py-2.5 text-sm leading-6 text-white/88"
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-[16px] border border-white/8 bg-white/[0.05] px-3.5 py-2 text-sm text-white/45">Thinking…</div>
              </div>
            )}
            {messages.length <= 1 && !loading && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {QUICK.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void send(q)}
                    className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-xs text-white/72 transition hover:border-mission-gold/45 hover:text-white"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-white/8 p-3">
            {inputSupported && (
              <button
                type="button"
                onClick={() => (listening ? stopListening() : startListening())}
                aria-label={listening ? "Stop listening" : "Talk to EILA"}
                title={listening ? "Stop" : "Talk"}
                className={`relative grid h-11 w-11 flex-shrink-0 place-items-center rounded-full border transition ${listening ? "border-mission-red/60 bg-mission-red/20 text-mission-red" : "border-white/10 bg-[#101218] text-white/55 hover:text-white/90"}`}
              >
                {listening && <span className="absolute inline-flex h-11 w-11 animate-ping rounded-full bg-mission-red/30" />}
                <Mic className="relative h-4 w-4" />
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={listening ? "Listening…" : "Ask MissionOS anything…"}
              className="h-11 flex-1 rounded-full border border-white/10 bg-[#101218] px-4 text-sm text-white outline-none transition focus:border-mission-gold/60"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-full bg-mission-gold text-mission-navy transition hover:brightness-110 disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </main>

        {/* ── Mission Control panel ── */}
        <aside className="space-y-4">
          <section className="glass-card rounded-[14px] p-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-mission-gold/80">
              <Compass className="h-3.5 w-3.5" /> North Star
            </div>
            <p className="text-sm leading-6 text-white/82">
              {state.northStar || "Not set yet. Ask MissionOS to help you define your north star."}
            </p>
          </section>

          <section className="glass-card rounded-[14px] p-4">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/45">
              <Target className="h-3.5 w-3.5" /> Active Goals
            </div>
            {grouped.length === 0 ? (
              <p className="text-sm text-white/45">No goals tracked yet. Tell MissionOS what you want to achieve and it&apos;ll break it down.</p>
            ) : (
              <div className="space-y-3">
                {grouped.map(({ h, items }) => (
                  <div key={h}>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-mission-gold/70">{HORIZON_LABEL[h] || h}</div>
                    <ul className="space-y-1.5">
                      {items.map((g) => (
                        <li key={g.id} className="flex items-start gap-2 text-sm leading-5 text-white/80">
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-mission-gold" />
                          <span>{g.title}{g.due ? <span className="text-white/40"> · {g.due}</span> : null}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {Array.isArray(state.priorities) && state.priorities.length > 0 && (
            <section className="glass-card rounded-[14px] p-4">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Top Priorities</div>
              <ol className="space-y-1.5">
                {state.priorities.map((p, i) => (
                  <li key={p.id} className="flex items-start gap-2 text-sm text-white/80">
                    <span className="text-mission-gold font-black">{i + 1}.</span>{p.title}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
