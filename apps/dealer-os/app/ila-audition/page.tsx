"use client";

import { useRef, useState } from "react";
import { Play, Square, Loader2, Volume2 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { authHeaders } from "@/lib/storeClient";

// Audition EILA's candidate voices in character — her REAL lines, the
// powerhouse blend (Beth Dutton fire + Billy Graham conviction + Tony Robbins
// belief + Mary Poppins warmth), not the old pure-Beth-Dutton phase this tool
// was first built for. Each play spends a few cents of ElevenLabs credit.
// Once Aaron picks, set the winning voiceId as DEFAULT_VOICE_ID in EVERY
// app's app/api/.../voice/route.ts — same voice everywhere, no exceptions.

type Candidate = { name: string; voiceId: string; vibe: string };

// Round 2 (July 4, 2026) — Aaron's note on round 1: "I don't like Zoe's current
// tone," then the real brief: "She can be confident, mature, commanding, and
// still be vibrant, young, and refreshing." Not a swap to bubbly/Gen-Z — a
// blend: authority that doesn't sound tired. Zoey stays only as the baseline
// everyone's already heard, for A/B comparison; the rest are new pulls from the
// ElevenLabs library filtered female/young/English/American and hand-picked for
// confident-but-bright delivery (skipped anything reading as naive/kiddie/BFF).
const CANDIDATES: Candidate[] = [
  { name: "Zoey (current)", voiceId: "ROkSP7oeR0SRS2aHJXMo", vibe: "The baseline — raspy, commanding, controlled. What everyone's already heard, for comparison only." },
  { name: "Jane", voiceId: "7rtH5kBukGPkzT4w11fh", vibe: "Confident young professional — clear, smooth, sharp. No wasted words, all authority." },
  { name: "Hannah", voiceId: "ZSNL4hPqCnqoMPaI4jGX", vibe: "All-American, confident and warm — commanding without ever going cold." },
  { name: "Sunny", voiceId: "2X7h8q4r8pMNZ7zRmpiF", vibe: "Bright and steady — confident energy that never tips into frantic." },
  { name: "Kristen", voiceId: "S75rdrgKsfARs0ND2nBt", vibe: "Confident but approachable — clean, positive, coach energy without the drama." },
  { name: "Nichalia", voiceId: "XfNU2rGpBa01ckF309OY", vibe: "Articulate and engaging — warm authority built to hold attention." },
];

const LINES = [
  "I've got eyes on your whole month. Pace, pipeline, follow-ups — all of it. Ask me anything.",
  "You're pacing five against a goal of four. Ahead, and it's only day twelve. Protect it — Sofia's been quiet three days, and she's your biggest live deal.",
  "You already know what the right move is. I'm just here to make sure you actually do it today.",
];

export default function IlaAuditionPage() {
  const [lineIdx, setLineIdx] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [playingId, setPlayingId] = useState("");
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function stop() {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setPlayingId("");
  }

  async function play(c: Candidate) {
    setError("");
    stop();
    setBusyId(c.voiceId);
    try {
      const res = await fetch("/api/ai/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ text: LINES[lineIdx], voiceId: c.voiceId }),
      });
      if (!res.ok) {
        setError(`Couldn't play ${c.name} right now. Try again in a moment.`);
        setBusyId("");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.onended = () => { setPlayingId(""); URL.revokeObjectURL(url); };
      await audio.play();
      setPlayingId(c.voiceId);
    } catch {
      setError(`Couldn't play ${c.name} right now. Try again in a moment.`);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      <SectionHeader title="EILA — Voice Audition" kicker="Hear her in character, then pick" />

      <div className="rise glass-card rounded-[14px] p-5">
        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-mission-gold">The line she&apos;ll say</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {LINES.map((line, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setLineIdx(i)}
              className={`max-w-full rounded-[12px] border px-3.5 py-2 text-left text-xs leading-5 transition ${i === lineIdx ? "border-mission-green/50 bg-mission-green/10 text-white" : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25 hover:text-white"}`}
            >
              {line}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mt-4 rounded-[12px] border border-mission-red/30 bg-mission-red/10 p-3 text-sm font-bold text-mission-red">{error}</div>}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CANDIDATES.map((c, i) => {
          const isBusy = busyId === c.voiceId;
          const isPlaying = playingId === c.voiceId;
          return (
            <div key={c.voiceId} className={`rise glass-card rounded-[16px] p-5 ${isPlaying ? "living-border" : ""}`} style={{ animationDelay: `${i * 55}ms` }}>
              <div className="flex items-center justify-between gap-3">
                <div className="font-display text-2xl font-black text-white">{c.name}</div>
                <Volume2 className={`h-5 w-5 ${isPlaying ? "text-mission-green" : "text-white/30"}`} />
              </div>
              <p className="mt-2 min-h-[44px] text-sm leading-6 text-white/58">{c.vibe}</p>
              <button
                type="button"
                onClick={() => (isPlaying ? stop() : play(c))}
                disabled={isBusy}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mission-green px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-mission-navy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : isPlaying ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isBusy ? "Loading…" : isPlaying ? "Stop" : `Hear ${c.name}`}
              </button>
              <div className="mt-2 text-center text-[10px] uppercase tracking-[0.14em] text-white/30">{c.voiceId}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-[12px] border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/60">
        Found the one? Tell me the name and it goes company-wide — the dealer app, Lite, and Finance all switch together, same as her personality. None of these right? Open the ElevenLabs Voice Library yourself (search &ldquo;confident young professional&rdquo; or similar), grab a voice ID, and send it over — I&apos;ll drop it in here to audition.
      </div>
    </div>
  );
}
