"use client";

import { useRef, useState } from "react";
import { Bot, Copy, HeartPulse, Loader2, MessageSquare, Mic, Send, Volume2, VolumeX, Zap } from "lucide-react";
import { type CrmLead as Lead } from "@/components/CrmProvider";
import { authHeaders } from "@/lib/storeClient";
import { streamChat } from "@/lib/streamChat";
import { useVoice } from "@/lib/voice";

type Tab = "health" | "draft" | "chat";

type HealthData = {
  score: number;
  label: "Hot" | "Warm" | "Cool" | "Cold";
  summary: string;
  flags: string[];
  recommendation: string;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

// ── helpers ──────────────────────────────────────────────────────────────────

async function callAI(action: string, lead: Lead, extra?: Record<string, unknown>) {
  const res = await fetch("/api/ai/crm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ action, lead, ...extra }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "AI request failed");
  }
  return res.json();
}

function healthAccent(label: string) {
  switch (label) {
    case "Hot":  return { text: "text-mission-green",  border: "border-mission-green/30",  bg: "bg-mission-green/10"  };
    case "Warm": return { text: "text-mission-amber",  border: "border-mission-amber/30",  bg: "bg-mission-amber/10"  };
    case "Cold": return { text: "text-mission-red",    border: "border-mission-red/30",    bg: "bg-mission-red/10"    };
    default:     return { text: "text-white/55",       border: "border-white/12",          bg: "bg-white/5"           };
  }
}

// ── main component ────────────────────────────────────────────────────────────

export function CrmAiPanel({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("health");

  // health
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState("");

  // next-action
  const [nextAction, setNextAction] = useState("");
  const [naLoading, setNaLoading] = useState(false);

  // draft
  const [channel, setChannel] = useState<"text" | "email">("text");
  const [draft, setDraft] = useState("");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [copied, setCopied] = useState(false);

  // chat
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { listening, speaking, inputSupported, outputSupported, startListening, stopListening, speak, stopSpeaking } =
    useVoice({
      onInterim: (t) => setInput(t),
      onFinal: (t) => { setInput(""); void sendMessage(t); },
    });

  // ── loaders ──

  async function loadHealth() {
    setHealthLoading(true);
    setHealthError("");
    try {
      const data = await callAI("health-check", lead);
      setHealth(data.health);
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : "Failed");
    } finally {
      setHealthLoading(false);
    }
  }

  async function loadNextAction() {
    setNaLoading(true);
    try {
      const data = await callAI("next-action", lead);
      setNextAction(data.suggestion || "");
    } catch {
      // silent — next action is supplementary
    } finally {
      setNaLoading(false);
    }
  }

  function openPanel() {
    setOpen(true);
    if (!health && !healthLoading)    loadHealth();
    if (!nextAction && !naLoading)    loadNextAction();
  }

  async function generateDraft() {
    setDraftLoading(true);
    setDraft("");
    setDraftError("");
    try {
      const data = await callAI("draft-followup", lead, { channel });
      setDraft(data.draft || "");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Failed");
    } finally {
      setDraftLoading(false);
    }
  }

  async function sendMessage(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || chatLoading) return;
    setInput("");
    const newHistory: ChatMessage[] = [...history, { role: "user", content: text }];
    // Add an empty assistant slot we stream EILA's reply into, token by token.
    setHistory([...newHistory, { role: "assistant", content: "" }]);
    setChatLoading(true);
    try {
      // send prior messages as history, current message separately
      const prior = newHistory.slice(0, -1);
      const appendToReply = (delta: string) =>
        setHistory((h) => {
          const copy = h.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + delta };
          return copy;
        });
      const { text: reply } = await streamChat(
        { action: "chat", lead, message: text, history: prior },
        await authHeaders(),
        {
          onToken: (delta) => {
            appendToReply(delta);
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          },
        },
      );
      if (voiceOn && reply) speak(reply);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Error";
      // Always collapse into the single streaming assistant slot — never push a
      // second assistant turn. Two adjacent assistant messages would then be
      // sent as history and rejected by the Messages API, bricking the session.
      setHistory((h) => {
        const copy = h.slice();
        const last = copy[copy.length - 1];
        const errText = `⚠️ ${errMsg}`;
        if (last && last.role === "assistant") {
          copy[copy.length - 1] = { role: "assistant", content: last.content ? `${last.content}\n\n${errText}` : errText };
        } else {
          copy.push({ role: "assistant", content: errText });
        }
        return copy;
      });
    } finally {
      setChatLoading(false);
    }
  }

  function copyDraft() {
    navigator.clipboard.writeText(draft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // ── closed state ──

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[12px] border border-mission-gold/30 bg-mission-gold/8 px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-mission-gold transition hover:border-mission-gold/55 hover:bg-mission-gold/15"
      >
        <Bot className="h-4 w-4" />
        EILA
      </button>
    );
  }

  // ── open ──

  const accent = health ? healthAccent(health.label) : healthAccent("Cool");

  return (
    <div className="mt-4 overflow-hidden rounded-[12px] border border-mission-gold/25 bg-black/20">
      {/* header */}
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-mission-gold">
          <Bot className="h-4 w-4" />
          EILA
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] font-bold text-white/35 transition hover:text-white/65"
        >
          Close
        </button>
      </div>

      {/* next-action banner */}
      <div className="border-b border-white/8 px-4 py-3">
        <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
          Recommended Next Action
        </div>
        {naLoading && (
          <div className="flex items-center gap-2 text-xs text-white/45">
            <Loader2 className="h-3 w-3 animate-spin" />
            Analyzing…
          </div>
        )}
        {!naLoading && nextAction && (
          <div className="flex items-start gap-2">
            <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-mission-amber" />
            <p className="text-sm leading-5 text-white/85">{nextAction}</p>
          </div>
        )}
        {!naLoading && !nextAction && (
          <button
            type="button"
            onClick={loadNextAction}
            className="text-xs text-mission-gold underline"
          >
            Generate suggestion
          </button>
        )}
      </div>

      {/* tabs */}
      <div className="flex border-b border-white/8">
        {(
          [
            { key: "health" as Tab, label: "Health",    Icon: HeartPulse   },
            { key: "draft"  as Tab, label: "Follow-up", Icon: MessageSquare },
            { key: "chat"   as Tab, label: "Ask EILA", Icon: Bot          },
          ] as const
        ).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-black uppercase tracking-[0.1em] transition ${
              tab === key
                ? "border-b-2 border-mission-gold text-mission-gold"
                : "text-white/40 hover:text-white/68"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* tab panels */}
      <div className="p-4">

        {/* ── Health ── */}
        {tab === "health" && (
          <div>
            {healthLoading && (
              <div className="flex items-center gap-2 py-6 text-sm text-white/45">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing deal health…
              </div>
            )}
            {!healthLoading && healthError && (
              <div className="space-y-2">
                <p className="text-xs text-mission-red">{healthError}</p>
                <button type="button" onClick={loadHealth} className="text-xs text-mission-gold underline">Retry</button>
              </div>
            )}
            {!healthLoading && !healthError && !health && (
              <button type="button" onClick={loadHealth} className="text-xs text-mission-gold underline">
                Run health check
              </button>
            )}
            {!healthLoading && health && (
              <div className="space-y-3">
                {/* score badge */}
                <div className={`flex items-center gap-4 rounded-[12px] border px-4 py-3 ${accent.border} ${accent.bg}`}>
                  <div className={`text-3xl font-black tabular-nums ${accent.text}`}>
                    {health.score}<span className="text-base font-bold text-white/40">/10</span>
                  </div>
                  <div>
                    <div className={`text-sm font-black ${accent.text}`}>{health.label}</div>
                    <div className="mt-0.5 text-xs leading-4 text-white/62">{health.summary}</div>
                  </div>
                </div>

                {/* flags */}
                {health.flags.length > 0 && (
                  <ul className="space-y-1.5">
                    {health.flags.map((flag, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs leading-4 text-white/68">
                        <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-mission-amber" />
                        {flag}
                      </li>
                    ))}
                  </ul>
                )}

                {/* recommendation */}
                {health.recommendation && (
                  <div className="rounded-[6px] border border-white/8 bg-white/5 px-3 py-2 text-xs leading-5 text-white/78">
                    <span className="font-black text-mission-gold">Priority: </span>
                    {health.recommendation}
                  </div>
                )}

                <button
                  type="button"
                  onClick={loadHealth}
                  className="text-[11px] text-white/32 underline transition hover:text-white/55"
                >
                  Refresh
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Draft Follow-up ── */}
        {tab === "draft" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {(["text", "email"] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannel(ch)}
                  className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.1em] transition ${
                    channel === ch
                      ? "bg-mission-gold text-mission-navy"
                      : "border border-white/15 text-white/48 hover:border-white/32"
                  }`}
                >
                  {ch === "text" ? "Text" : "Email"}
                </button>
              ))}
              <button
                type="button"
                onClick={generateDraft}
                disabled={draftLoading}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-mission-gold/45 px-3 py-1 text-xs font-black uppercase tracking-[0.1em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy disabled:opacity-45"
              >
                {draftLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                Generate
              </button>
            </div>

            {draftError && <p className="text-xs text-mission-red">{draftError}</p>}

            {!draft && !draftLoading && !draftError && (
              <p className="text-xs text-white/38">
                Hit Generate to write a personalized{" "}
                {channel === "text" ? "text message" : "email"} for{" "}
                {lead.customer || "this customer"}.
              </p>
            )}

            {draft && (
              <div className="relative rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 pr-8">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-white/85">
                  {draft}
                </pre>
                <button
                  type="button"
                  onClick={copyDraft}
                  title="Copy"
                  className="absolute right-2 top-2 rounded p-1 text-white/30 transition hover:text-white/70"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {copied && (
                  <div className="mt-1 text-right text-[10px] text-mission-green">Copied!</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Chat ── */}
        {tab === "chat" && (
          <div className="space-y-3">
            {/* message list */}
            <div className="max-h-[260px] overflow-y-auto space-y-2 pr-1">
              {history.length === 0 && (
                <p className="text-xs text-white/38">
                  Ask anything about this deal.{" "}
                  <span className="italic text-white/28">
                    &quot;What objections should I expect?&quot; · &quot;How do I close this today?&quot; · &quot;Draft a manager T.O.&quot;
                  </span>
                </p>
              )}
              {history.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-[12px] px-3 py-2 text-sm leading-5 ${
                      msg.role === "user"
                        ? "bg-mission-gold/20 text-white"
                        : "bg-white/8 text-white/85"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="rounded-[12px] bg-white/8 px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-white/45" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* input row */}
            <div className="flex gap-2">
              {inputSupported && (
                <button
                  type="button"
                  onClick={() => (listening ? stopListening() : startListening())}
                  aria-label={listening ? "Stop listening" : "Talk to EILA"}
                  title={listening ? "Stop listening" : "Talk to EILA"}
                  className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] border transition ${
                    listening
                      ? "border-mission-red/60 bg-mission-red/20 text-mission-red"
                      : "border-white/10 bg-[#14161c]/80 text-white/55 hover:text-white/90"
                  }`}
                >
                  {listening && <span className="absolute inline-flex h-9 w-9 animate-ping rounded-[12px] bg-mission-red/25" />}
                  <Mic className="relative h-4 w-4" />
                </button>
              )}
              <input
                className="h-9 flex-1 rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-mission-gold/60"
                placeholder={listening ? "Listening…" : "Ask EILA about this deal…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              {outputSupported && (
                <button
                  type="button"
                  onClick={() => { const n = !voiceOn; setVoiceOn(n); if (!n) stopSpeaking(); }}
                  aria-label={voiceOn ? "Turn EILA's voice off" : "Turn EILA's voice on"}
                  title={voiceOn ? "EILA's voice is on" : "EILA's voice is off"}
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] border transition ${
                    voiceOn ? "border-mission-gold/50 bg-mission-gold/15 text-mission-gold" : "border-white/10 bg-[#14161c]/80 text-white/45 hover:text-white/80"
                  }`}
                >
                  {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => sendMessage()}
                disabled={chatLoading || !input.trim()}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] bg-mission-gold text-mission-navy transition hover:brightness-110 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            {speaking && (
              <button type="button" onClick={stopSpeaking} className="text-[11px] font-bold text-mission-gold/80 underline">
                Stop speaking
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
