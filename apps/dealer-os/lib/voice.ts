"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders } from "@/lib/storeClient";

// Voice for EILA — speech-to-text in (Web Speech API) and text-to-speech out
// (speechSynthesis), so talking to EILA feels like talking to someone on an
// iPhone. Both degrade gracefully: if the browser lacks support the buttons
// hide themselves via the `*Supported` flags.

type VoiceOpts = {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
};

export function useVoice({ onFinal, onInterim }: VoiceOpts) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [inputSupported, setInputSupported] = useState(false);
  const [outputSupported, setOutputSupported] = useState(false);
  const recRef = useRef<any>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null); // current TTS blob URL, so it's always revoked
  const primedRef = useRef(false);
  const finalCb = useRef(onFinal);
  const interimCb = useRef(onInterim);
  finalCb.current = onFinal;
  interimCb.current = onInterim;

  useEffect(() => {
    if (typeof window === "undefined") return;
    setOutputSupported(!!window.speechSynthesis);
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setInputSupported(true);
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i];
        if (tr.isFinal) final += tr[0].transcript;
        else interim += tr[0].transcript;
      }
      if (interim && interimCb.current) interimCb.current(interim);
      if (final.trim()) finalCb.current(final.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => {
      try { rec.abort(); } catch { /* noop */ }
    };
  }, []);

  // Voices load asynchronously — populate them on mount AND on voiceschanged so
  // a fitting female voice is available by the time EILA speaks (otherwise the
  // first utterance falls back to the browser default, which varies by device).
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices() || []; };
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => { try { window.speechSynthesis.removeEventListener?.("voiceschanged", load); } catch { /* noop */ } };
  }, []);

  // iOS/Safari only lets audio start inside a user tap. EILA's reply arrives
  // seconds AFTER the tap, so a fresh Audio() there is blocked — total silence
  // on iPhone. Fix: on the first touch anywhere, play a tiny silent clip on ONE
  // persistent <audio> element ("blessing" it), then reuse that same element for
  // every reply. A blessed element may start playback at any later time.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SILENT_WAV =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    const prime = () => {
      if (primedRef.current) return;
      primedRef.current = true;
      const el = new Audio(SILENT_WAV);
      el.play().then(() => el.pause()).catch(() => { primedRef.current = false; });
      audioRef.current = el;
      window.removeEventListener("touchend", prime);
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
    window.addEventListener("touchend", prime, { passive: true });
    window.addEventListener("pointerdown", prime, { passive: true });
    window.addEventListener("keydown", prime);
    return () => {
      window.removeEventListener("touchend", prime);
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  const startListening = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      window.speechSynthesis?.cancel();
      rec.start();
      setListening(true);
    } catch { /* already started */ }
  }, []);

  const stopListening = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    // Pause + clear, but KEEP the element — it holds the iOS gesture blessing.
    const a = audioRef.current;
    if (a) { try { a.pause(); a.removeAttribute("src"); } catch { /* noop */ } }
    // Interrupting playback means onended never fires, so revoke the blob URL
    // here — otherwise every barge-in leaks an object URL for the session.
    if (objectUrlRef.current) { try { URL.revokeObjectURL(objectUrlRef.current); } catch { /* noop */ } objectUrlRef.current = null; }
    setSpeaking(false);
  }, []);

  // Fallback only: the device's own voice, used if the premium ElevenLabs voice
  // is unavailable (offline / API down) so EILA still talks. EILA is female —
  // prefer a confident female voice (was still picking male from the Jimmy era).
  const browserSpeak = useCallback((clean: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.0;
    u.pitch = 1.0;
    const voices = voicesRef.current.length ? voicesRef.current : (window.speechSynthesis.getVoices() || []);
    const find = (re: RegExp) => voices.find((v) => re.test(v.name || ""));
    const MALE = /\bmale\b|daniel|arthur|oliver|george|james|ryan|jamie|alex|aaron|tom|david|fred|lee|reed|eddy|rishi|guy/i;
    const pick =
      find(/samantha/i) ||
      find(/google uk english female/i) ||
      find(/\b(ava|allison|serena|victoria|karen|aria|jenny|sonia|tessa|moira|fiona|catherine|susan|zira|nicky|kathy)\b/i) ||
      find(/uk english female|british.*female/i) ||
      find(/\bfemale\b/i) ||
      voices.find((v) => /^en/i.test(v.lang) && !MALE.test(v.name || "")) ||
      null;
    if (pick) u.voice = pick;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  // EILA's real voice — ElevenLabs (Zoey), served from /api/ai/voice. Strips
  // markdown so she doesn't read "asterisk", plays the returned audio, and falls
  // back to the device voice if the call fails so she never goes silent.
  const speak = useCallback(async (text: string) => {
    if (typeof window === "undefined") return;
    const clean = text.replace(/[*_`#>|~]/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    stopSpeaking();
    try {
      const res = await fetch("/api/ai/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ text: clean }),
      });
      if (!res.ok) throw new Error("tts " + res.status);
      const blob = await res.blob();
      if (!blob || blob.size < 1000) throw new Error("empty audio");
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const clearUrl = () => { if (objectUrlRef.current) { try { URL.revokeObjectURL(objectUrlRef.current); } catch { /* noop */ } objectUrlRef.current = null; } };
      // Reuse the gesture-blessed element (iOS blocks a fresh Audio() this long
      // after the tap); fall back to a new one where no priming ever happened.
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.onplay = () => setSpeaking(true);
      audio.onended = () => { setSpeaking(false); clearUrl(); };
      audio.onerror = () => { setSpeaking(false); clearUrl(); };
      audio.src = url;
      await audio.play();
    } catch {
      browserSpeak(clean); // premium voice down → still talks
    }
  }, [stopSpeaking, browserSpeak]);

  return {
    listening,
    speaking,
    inputSupported,
    outputSupported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
