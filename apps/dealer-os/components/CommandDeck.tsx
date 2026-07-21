"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2, Mic, Send, Volume2, VolumeX, X, Zap } from "lucide-react";
import { authHeaders } from "@/lib/storeClient";
import { streamChat } from "@/lib/streamChat";
import { ASK_EILA_EVENT } from "@/lib/askIla";
import { useVoice } from "@/lib/voice";
import { IlaCore } from "@/components/IlaCore";

// EILA's "Command Deck" — a docked glass console along the bottom edge. Idle, it's
// a thin breathing line; ask it (type OR talk) and it rises into a translucent
// answer panel, then settles back. Never floats over content. EILA speaks her
// answer out loud by default (one-tap mute, remembered), and the sigil pulses
// while he talks. Powered by the same /api/ai/crm chat + tools as before.

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

// Friendly labels for the "watch him work" chips.
const TOOL_LABEL: Record<string, string> = {
  query_deals: "Drilling the deals",
  rep_detail: "Reading the rep",
  lookup_rate: "Pulling the rate",
  remember_rep: "Noting it down",
};

const DECK_STYLES = `
@keyframes cdBreathe{0%,100%{box-shadow:0 0 0 1px rgba(96,150,255,.35),0 0 14px rgba(96,150,255,.20)}50%{box-shadow:0 0 0 1px rgba(96,150,255,.6),0 0 26px rgba(96,150,255,.48)}}
@keyframes cdSpeak{0%,100%{box-shadow:0 0 0 1px rgba(96,150,255,.55),0 0 18px rgba(96,150,255,.4)}50%{box-shadow:0 0 0 2px rgba(96,150,255,.9),0 0 34px rgba(96,150,255,.72)}}
@keyframes cdWave{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
@keyframes cdScan{0%{transform:translateX(-120%)}100%{transform:translateX(960%)}}
@keyframes cdRise{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:translateY(0)}}
.cd-sigil{animation:cdBreathe 3s ease-in-out infinite}
.cd-sigil.cd-on{animation:cdSpeak 1.1s ease-in-out infinite}
.cd-wb{width:3px;border-radius:2px;background:#6096ff;transform-origin:center;animation:cdWave 1s ease-in-out infinite}
.cd-scan{position:absolute;bottom:0;left:0;height:2px;width:64px;background:linear-gradient(90deg,transparent,#6096ff,transparent);animation:cdScan 4.5s linear infinite;pointer-events:none}
.cd-panel{animation:cdRise .45s ease-out both}
/* EILA's console FOLLOWS THE THEME: dark glass on the dark themes, a clean
   white sheet on Sky (Aaron: "we are on a light theme now"). Backgrounds live
   here, not in bg-[hex] utilities (Tailwind never generated those). */
.cd-panel{background:rgba(11,15,20,.92)}
.cd-inputbar{background:rgba(10,15,22,.92)}
.cd-toolchip{color:#aecfff}
:root[data-theme="sky"] .cd-panel{background:rgba(255,255,255,.96);border-color:rgb(15 23 42 / 0.08);
  box-shadow:0 1px 2px rgb(15 23 42 / 0.05),0 26px 60px -22px rgb(37 78 178 / 0.30)}
:root[data-theme="sky"] .cd-inputbar{background:rgba(255,255,255,.96);
  box-shadow:0 1px 2px rgb(15 23 42 / 0.05),0 18px 44px -18px rgb(37 78 178 / 0.32),0 0 22px rgb(96 150 255 / 0.10)}
:root[data-theme="sky"] .cd-toolchip{color:#2456b8}
/* EILA's mark carries its own disc, halo, and orbit ring (IlaCore) — the orb
   wrapper stays transparent so no dark puck clashes with the circular mark on
   light themes. overflow VISIBLE lets the halo soft-fade with no clip edge. */
.ila-orb{position:relative;overflow:visible;background:transparent;animation:ilaGlow 3.4s ease-in-out infinite}
.ila-orb.cd-on{animation:ilaGlow 1.3s ease-in-out infinite}
@keyframes ilaGlow{0%,100%{box-shadow:0 0 12px 1px rgba(70,140,255,.28)}50%{box-shadow:0 0 26px 4px rgba(84,150,255,.55)}}
@media (prefers-reduced-motion:reduce){.cd-sigil,.cd-wb,.cd-scan,.cd-panel,.ila-orb{animation:none}}
`;

function shortcutsFor(path: string): string[] {
  if (path === "/") return ["Which deals are stuck in finance?", "Who's behind pace?", "Where are we losing gross?"];
  if (path.startsWith("/crm-desk")) return ["Who should I follow up with first?", "Any no-shows to re-set?", "Draft a text to my hottest lead"];
  if (path.startsWith("/finance")) return ["How's our PVR?", "Audit today's deals", "Buy rate for a 2024 at 740, 66mo?"];
  if (path.startsWith("/deal")) return ["Which deals are missing invoice?", "Any products on a cash deal?", "Audit this month's deals"];
  if (path.startsWith("/goals") || path.startsWith("/my-scorecard")) return ["Am I on pace?", "What do I need per day?", "Coach me on a price objection"];
  if (path.startsWith("/team") || path.startsWith("/recognition")) return ["Who's my MVP?", "Who needs coaching?", "How's the team trending?"];
  return ["How's the store doing today?", "Who's my hottest lead?", "Coach me on an objection"];
}

export function CommandDeck() {
  const pathname = usePathname();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Collapsed by default — EILA is summoned (like Siri), not a permanent bar.
  const [expanded, setExpanded] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true); // EILA speaks by default — alive
  const endRef = useRef<HTMLDivElement>(null);

  const { listening, speaking, inputSupported, outputSupported, startListening, stopListening, speak, stopSpeaking } =
    useVoice({
      onInterim: (t) => setInput(t),
      onFinal: (t) => { setInput(""); void send(t); },
    });

  const shortcuts = useMemo(() => shortcutsFor(pathname || "/"), [pathname]);

  // Remember the mute preference across sessions.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("ilaVoice") : null;
    if (saved === "off") setVoiceOn(false);
  }, []);

  // Tap-to-explain handoff: any screen can askIla("Explain my …") and the deck
  // rises with the question already sent — the number hands you to EILA.
  const sendRef = useRef<((text?: string) => Promise<void>) | null>(null);
  useEffect(() => { sendRef.current = send; });
  useEffect(() => {
    function onAsk(e: Event) {
      const prompt = (e as CustomEvent<string>).detail?.trim();
      if (!prompt) return;
      setExpanded(true);
      setOpen(true);
      void sendRef.current?.(prompt);
    }
    window.addEventListener(ASK_EILA_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EILA_EVENT, onAsk);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, open]);

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || loading) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    // Push the user turn plus an empty assistant slot we stream EILA into.
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", tools: [] }]);
    setInput("");
    setLoading(true);
    setOpen(true);
    try {
      const appendToReply = (delta: string) =>
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + delta };
          return copy;
        });
      const { text: reply, tools } = await streamChat(
        { action: "chat", message: text, history },
        await authHeaders(),
        { onToken: appendToReply },
      );
      if (!reply.trim()) {
        // Empty reply — swap the slot for a clean, in-character nudge.
        const friendly = "Hit a snag pulling that one — give me another shot.";
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: friendly };
          return copy;
        });
        if (voiceOn) speak(friendly);
      } else {
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: reply, tools };
          return copy;
        });
        if (voiceOn) speak(reply);
      }
    } catch {
      // Never surface a raw API error — turn any failure into a clean line.
      // Always collapse into the single streaming assistant slot (never push a
      // second assistant turn — two in a row would brick the next message).
      const friendly = "Lost you for a second there — say that again?";
      setMessages((m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        if (last && last.role === "assistant") copy[copy.length - 1] = { role: "assistant", content: friendly };
        else copy.push({ role: "assistant", content: friendly });
        return copy;
      });
      if (voiceOn) speak(friendly);
    } finally {
      setLoading(false);
    }
  }

  function toggleMic() { if (listening) stopListening(); else startListening(); }
  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    if (typeof window !== "undefined") window.localStorage.setItem("ilaVoice", next ? "on" : "off");
    if (!next) stopSpeaking();
  }
  function dismiss() { setOpen(false); setExpanded(false); stopSpeaking(); }

  const status = listening ? "Listening…" : speaking ? "Speaking…" : loading ? "Working…" : "Ready";
  const statusColor = listening ? "text-mission-red" : "text-mission-green";

  return (
    <>
      <style>{DECK_STYLES}</style>

      {/* Collapsed — a single EILA orb you summon, like Siri. No permanent bar. */}
      {!expanded && (
        <button type="button" onClick={() => { setExpanded(true); setOpen(true); }} aria-label="Ask EILA"
          style={{ position: "fixed", bottom: "calc(1rem + env(safe-area-inset-bottom))", right: "1rem" }}
          className="ila-orb z-[60] grid h-14 w-14 place-items-center rounded-[15px]">
          <IlaCore className="h-full w-full" intensity={speaking ? 0.9 : 0.7} />
        </button>
      )}

      {/* Expanded — her full console. Tap her sigil or the × to send her away. */}
      {expanded && (
      <div style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }} className="fixed left-1/2 z-[60] w-[calc(100vw-1.25rem)] max-w-[660px] -translate-x-1/2 lg:left-[calc(50%+2rem)]">

        {/* Rising answer panel */}
        {open && (
          <div className="living-border cd-panel relative mb-2 overflow-hidden rounded-[20px] border border-[#6096ff]/20 shadow-[0_24px_70px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
            <div className="relative flex items-center gap-2.5 border-b border-white/8 px-4 py-2.5">
              <span className={`ila-orb ${speaking ? "cd-on" : ""} grid h-7 w-7 place-items-center rounded-[8px]`}>
                <IlaCore className="h-full w-full" intensity={speaking ? 0.9 : 0.6} />
              </span>
              <span className="font-display text-sm font-black text-white">EILA</span>
              <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${statusColor}`}>
                <span className="relative flex h-1.5 w-1.5">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${listening ? "bg-mission-red" : "bg-mission-green"}`} />
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${listening ? "bg-mission-red" : "bg-mission-green"}`} />
                </span>
                {status}
              </span>
              <div className="flex-1" />
              {outputSupported && (
                <button type="button" onClick={toggleVoice} aria-label={voiceOn ? "Mute EILA" : "Unmute EILA"} title={voiceOn ? "EILA's voice is on" : "EILA's muted"}
                  className={`grid h-7 w-7 place-items-center rounded-full transition ${voiceOn ? "bg-white/10 text-white" : "text-white/35 hover:text-white/70"}`}>
                  {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
              )}
              <button type="button" onClick={dismiss} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-full text-white/35 transition hover:text-white/80">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative max-h-[44dvh] space-y-2.5 overflow-y-auto px-4 py-3">
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start gap-1"}>
                  {m.role === "assistant" && m.tools && m.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.tools.map((t) => (
                        <span key={t} className="cd-toolchip inline-flex items-center gap-1 rounded-full border border-[#6096ff]/25 bg-[#6096ff]/10 px-2 py-0.5 text-[10px] font-semibold">
                          <Zap className="h-2.5 w-2.5" /> {TOOL_LABEL[t] || t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={m.role === "user"
                    ? "max-w-[82%] break-words rounded-[13px] rounded-br-sm bg-mission-gold/90 px-3 py-2 text-sm font-semibold text-mission-navy"
                    : "max-w-[88%] whitespace-pre-wrap break-words rounded-[13px] rounded-bl-sm border border-white/8 bg-white/[0.04] px-3 py-2 text-sm leading-6 text-white/88"}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-sm text-white/45">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> EILA&apos;s reading the floor…
                </div>
              )}
              {messages.length === 0 && !loading && (
                <div className="flex flex-wrap gap-1.5">
                  {shortcuts.map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)}
                      className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-left text-xs text-white/72 transition hover:border-[#6096ff]/45 hover:text-white">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>
        )}

        {/* The command deck bar — dark glass with the neon-green living rim (our standard) */}
        <div className="living-border cd-inputbar relative flex items-center gap-2.5 rounded-[18px] px-3 py-2.5 shadow-[0_16px_46px_rgba(0,0,0,0.55),0_0_22px_rgba(96,150,255,0.16)] backdrop-blur-2xl">
          <button type="button" onClick={dismiss} aria-label="Close EILA"
            className={`ila-orb ${speaking ? "cd-on" : ""} grid h-9 w-9 flex-none place-items-center rounded-[10px]`}>
            <IlaCore className="h-full w-full" intensity={speaking ? 0.9 : 0.6} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } if (e.key === "Escape") dismiss(); }}
            placeholder={listening ? "Listening…" : "Ask EILA anything — deals, reps, rates…"}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none"
          />
          {listening && (
            <div className="flex items-center gap-[3px]" aria-hidden>
              <span className="cd-wb h-3.5" style={{ animationDelay: "0s" }} />
              <span className="cd-wb h-5" style={{ animationDelay: ".15s" }} />
              <span className="cd-wb h-2.5" style={{ animationDelay: ".3s" }} />
              <span className="cd-wb h-4" style={{ animationDelay: ".45s" }} />
            </div>
          )}
          {outputSupported && (
            <button type="button" onClick={toggleVoice} aria-label={voiceOn ? "Mute EILA" : "Unmute EILA"} title={voiceOn ? "EILA's voice is on" : "EILA's muted"}
              className={`grid h-8 w-8 flex-none place-items-center rounded-full transition ${voiceOn ? "text-white" : "text-white/35 hover:text-white/70"}`}>
              {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          )}
          {inputSupported && (
            <button type="button" onClick={toggleMic} aria-label={listening ? "Stop" : "Talk to EILA"}
              className={`relative grid h-9 w-9 flex-none place-items-center rounded-full border transition ${listening ? "border-mission-red/50 bg-mission-red/15 text-mission-red" : "border-white/15 bg-white/[0.06] text-white/60 hover:text-white"}`}>
              {listening && <span className="absolute inline-flex h-9 w-9 animate-ping rounded-full bg-mission-red/25" />}
              <Mic className="relative h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={() => void send()} disabled={loading || !input.trim()} aria-label="Ask EILA"
            className="grid h-9 w-9 flex-none place-items-center rounded-full bg-white text-mission-navy shadow-[0_2px_10px_rgba(0,0,0,0.4)] transition hover:brightness-105 disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
      )}
    </>
  );
}
