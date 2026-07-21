"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ImagePlus, Send, Sparkles, Square, Volume2, X } from "lucide-react";
import { useMission } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { TOOL_MARKER, type IlaToolCall } from "@/lib/ila-tools";
import { executeIlaTool } from "@/lib/ila-hands";

// "action" is distinct from "assistant" — it's not something she SAID, it's
// something she DID (a hands tool actually changed your data). Rendered as its
// own card so a real change never gets buried inside a sentence.
// A photo the rep attached in the composer. `dataUrl` is the (downscaled) image
// for on-screen display; `data` is the raw base64 (no prefix) sent to the model.
interface Attachment {
  dataUrl: string;
  mediaType: string;
  data: string;
}

interface Msg {
  role: "user" | "assistant" | "action";
  content: string;
  images?: Attachment[];
}

const MAX_TOOL_ROUNDS = 4;

// Attach guardrails — kept in lockstep with the server's /api/ila caps. We
// downscale on the client so a 4MB phone screenshot rides as a light ~200KB
// JPEG the model reads just as well.
const MAX_ATTACH = 4;
const MAX_IMAGE_DIM = 1400; // longest edge — plenty for a legible screenshot
const TARGET_IMAGE_BASE64 = 1_100_000; // stay comfortably under the server's 1.5M cap

// Downscale + re-encode a picked image to a compact JPEG so it's cheap to send
// and store. Returns null for anything that isn't a readable image.
async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("decode failed"));
    im.src = dataUrl;
  });
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const data = dataUrl.split(",")[1] ?? "";
    return data ? { dataUrl, mediaType: file.type, data } : null;
  }
  // White matte first — screenshots with transparency would otherwise flatten
  // to black once we re-encode as JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  let quality = 0.82;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length - out.indexOf(",") - 1 > TARGET_IMAGE_BASE64 && quality > 0.4) {
    quality -= 0.12;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  const data = out.split(",")[1] ?? "";
  return data ? { dataUrl: out, mediaType: "image/jpeg", data } : null;
}

// Persist the conversation so opening EILA feels like returning to a thread, not
// a blank box every time. Kept in localStorage (client-only, per-device), capped
// so it can't grow without bound.
// v2: retire threads saved before the texting redesign — they carry the old
// machine-generated "day plan" data-dump as the user's message, which now reads
// as stale clutter. Bumping the key gives everyone a clean thread on next open.
const CHAT_STORAGE_KEY = "eila.chat.v2";
const CHAT_HISTORY_CAP = 60;

const SUGGESTIONS = [
  "Brief me like my assistant.",
  "Add something to my day.",
  "Watch my money and tell me what matters.",
  "Remember something about how I work.",
];

export function IlaChat({ open, onClose, initialPrompt }: { open: boolean; onClose: () => void; initialPrompt?: string }) {
  const { data, getData, addIlaMemories, updateDaysOff, updateProducts, updateDeal, updateMoney, updatePlan, addDeal, addDeals, importDeals, removeDeal, addLifeItem, clearSampleData, forgetIlaMemory } = useMission();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState("");
  const [busy, setBusy] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<number | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const firedPrompt = useRef<string | undefined>(undefined);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Pull picked photos in, downscale them, and queue them under the composer.
  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setAttachError("");
    const room = MAX_ATTACH - attachments.length;
    if (room <= 0) {
      setAttachError(`You can attach up to ${MAX_ATTACH} photos at a time.`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    const ready: Attachment[] = [];
    for (const f of picked) {
      try {
        const a = await fileToAttachment(f);
        if (a) ready.push(a);
      } catch {
        /* unreadable image — skip it */
      }
    }
    if (!ready.length) {
      setAttachError("Couldn't read that image — try a JPG or PNG.");
      return;
    }
    setAttachments((prev) => [...prev, ...ready].slice(0, MAX_ATTACH));
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachError("");
  }

  // Hydrate the saved thread once on mount so the chat isn't a blank slate.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (Array.isArray(saved) && saved.length) setMessages(saved as Msg[]);
    } catch {
      /* corrupt/absent history just means we start fresh */
    }
  }, []);

  // Persist on every change. The `!messages.length` guard means the initial empty
  // state (and the mount-time render before hydration lands) never clobbers a
  // saved thread; the trailing empty "typing" bubble is dropped before saving.
  useEffect(() => {
    if (!messages.length) return;
    try {
      // Never persist raw image base64 — it would blow the localStorage quota
      // fast. Keep the bubble visible after reload with a lightweight marker.
      const toSave = messages
        .filter((m, i) => m.content || m.images?.length || i !== messages.length - 1)
        .slice(-CHAT_HISTORY_CAP)
        .map((m) => (m.images?.length ? { role: m.role, content: m.content || "📷 Photo" } : m));
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      /* storage full / disabled — non-fatal, the chat still works this session */
    }
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Collapse the growing composer back to one line once it's been cleared (after
  // a send) — the onInput grow handler never fires on a programmatic reset.
  useEffect(() => {
    if (!input && inputRef.current) inputRef.current.style.height = "auto";
  }, [input]);

  // Focus the input when EILA opens, so she's ready to talk to the moment she's
  // on screen — like tapping into a text thread.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Full-screen thread owns the viewport while open: lock body scroll and let
  // Escape close it (the shared Sheet used to do this; the chat is its own
  // surface now).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  useEffect(() => {
    if (!open && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
      setSpeakingKey(null);
      setVoiceError("");
    }
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [open]);

  // A screen handed EILA an opening request (e.g. the follow-up queue's
  // one-tap draft) — send it the moment she opens, exactly once per hand-off.
  useEffect(() => {
    if (open && initialPrompt && firedPrompt.current !== initialPrompt && !busy) {
      firedPrompt.current = initialPrompt;
      void send(initialPrompt);
    }
    if (!open) firedPrompt.current = undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPrompt]);

  async function send(text: string, imgs: Attachment[] = []) {
    const clean = text.trim();
    if ((!clean && !imgs.length) || busy || !data.profile) return;
    const next: Msg[] = [...messages, { role: "user", content: clean, ...(imgs.length ? { images: imgs } : {}) }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setAttachments([]);
    setAttachError("");
    setBusy(true);

    // Watchdog: a dropped connection mid-stream must never wedge the chat in a
    // silent "busy" state — after 60s of no completion the request aborts, the
    // catch shows a clean retry message, and `finally` frees the input.
    const watchdog = new AbortController();
    // Per-ROUND leash: a multi-fix turn legitimately takes several streams —
    // rearmed at each round start so only genuine silence aborts.
    let watchdogTimer = setTimeout(() => watchdog.abort(), 60_000);
    const rearmWatchdog = () => { clearTimeout(watchdogTimer); watchdogTimer = setTimeout(() => watchdog.abort(), 60_000); };
    try {
      const sb = getSupabase();
      const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;

      // Her hands read the LIVE store (getData → dataRef.current, which every
      // mutator updates synchronously) at the moment each round and each tool
      // runs. Two fixes in one exchange still see each other — and anything the
      // USER changes mid-turn (another sheet, a cloud pull) is seen too, instead
      // of being overwritten from a frozen turn-start copy (July 8 audit #4).

      // The conversation as the API sees it — grows tool_use/tool_result
      // blocks as she fixes things, then loops until she's just talking.
      type ApiMsg = { role: "user" | "assistant"; content: string | unknown[] };
      // `next` is only ever user/assistant at this point (action cards are a
      // display-only construct added later, never part of the outgoing turn) —
      // the filter is just to satisfy the narrower ApiMsg role type.
      const convo: ApiMsg[] = next
        .filter((m): m is Msg & { role: "user" | "assistant" } => m.role !== "action")
        .map((m, idx, arr) => {
          // Only the newest user turn ships its photos to the model — a
          // screenshot pertains to the moment it was sent, and re-uploading
          // base64 on every turn (and every tool round) would balloon the
          // request. Earlier turns go up as their text.
          if (idx === arr.length - 1 && m.images?.length) {
            return {
              role: m.role,
              content: [
                ...m.images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } })),
                ...(m.content ? [{ type: "text", text: m.content }] : []),
              ],
            };
          }
          return { role: m.role, content: m.content };
        });
      let acc = ""; // everything shown in her CURRENT bubble — resets each time an action card splits it
      let narrative = ""; // her full spoken text across every round + action, for reflection only

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        rearmWatchdog();
        // Fresh snapshot for THIS round's context — includes her own earlier
        // fixes this turn and any mid-turn user edits.
        const snap = getData();
        if (!snap.profile) break; // profile wiped mid-turn (reset / sign-out)
        const res = await fetch("/api/ila", {
          method: "POST",
          signal: watchdog.signal,
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({
            messages: convo,
            profile: snap.profile,
            plan: snap.profile.plan,
            deals: snap.deals,
            lifeItems: snap.lifeItems ?? [],
            memories: snap.ilaMemories ?? [],
            allowTools: true,
          }),
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          const msg = res.status === 401 ? "Sign in to talk to EILA." : res.status === 402 ? "Subscribe to unlock EILA." : err.error || "EILA couldn't respond.";
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", content: acc ? `${acc}\n\n${msg}` : msg };
            return copy;
          });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let raw = "";
        const base = acc ? `${acc}\n` : "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          const visible = raw.split(TOOL_MARKER)[0];
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", content: base + visible };
            return copy;
          });
        }

        const [spoken, toolJson] = raw.split(TOOL_MARKER);
        acc = base + spoken;
        narrative = narrative ? `${narrative}\n${spoken}` : spoken;
        if (!toolJson) break; // no tools this round — she's done

        let calls: IlaToolCall[] = [];
        try { calls = JSON.parse(toolJson); } catch { break; }
        if (!Array.isArray(calls) || !calls.length) break;

        // Lock in whatever she's said so far as its own bubble — her actions
        // land as distinct cards below it, never blended into her prose.
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });

        // Execute her fixes through the same store the user's taps use.
        const results: { tool_use_id: string; content: string; is_error?: boolean }[] = [];
        for (const call of calls) {
          const r = await executeIlaTool(call, {
            // Live getters: each access reads the store's latest write, so a
            // tool builds its change from the freshest state — EILA's own fixes
            // earlier this turn AND anything the user changed mid-turn — never
            // from a stale copy that would clobber on write.
            get profile() { return getData().profile!; },
            get deals() { return getData().deals; },
            get memories() { return getData().ilaMemories ?? []; },
            updateDaysOff,
            updateProducts,
            updateDeal,
            updateMoney,
            updatePlan,
            addDeal,
            addDeals,
            importDeals,
            removeDeal,
            addLifeItem,
            clearSampleData,
            forgetIlaMemory,
            authToken: token,
          });
          results.push({ tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
          if (r.friendly) {
            narrative = `${narrative}\n${r.friendly}`;
            setMessages((m) => [...m, { role: "action", content: r.friendly! }]);
          }
        }

        // Reopen a fresh bubble for whatever she says next this round.
        acc = "";
        setMessages((m) => [...m, { role: "assistant", content: "" }]);

        // Hand her the results and let her keep going.
        convo.push({
          role: "assistant",
          content: [
            ...(spoken.trim() ? [{ type: "text", text: spoken }] : []),
            ...calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
          ],
        });
        convo.push({
          role: "user",
          content: results.map((r) => ({ type: "tool_result", ...r })),
        });
        // Round cap reached with fixes already applied → say so instead of
        // ending on silence (the changes ARE saved; she just ran out of turns).
        if (round === MAX_TOOL_ROUNDS - 1 && results.length) {
          const closing = "All set — the changes above are applied and your numbers are recalculated.";
          narrative = `${narrative}\n${closing}`;
          setMessages((m) => [...m.filter((x) => !(x.role === "assistant" && !x.content)), { role: "assistant", content: closing }]);
        }
      }

      // EILA learns from the exchange: distill durable notes in the background.
      // Fire-and-forget — a failed reflection never disturbs the chat. Uses the
      // full narrative (every bubble + action this turn), not just her final
      // bubble, since actions now split what she said into separate cards.
      if (narrative.trim() && token) {
        fetch("/api/ila/reflect", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            messages: [...next, { role: "assistant", content: narrative }],
            known: (getData().ilaMemories ?? []).map((m) => m.note),
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (j?.notes?.length) addIlaMemories(j.notes);
          })
          .catch(() => {});
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

  function stopSpeech() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeakingKey(null);
  }

  function speak(text: string, key: number) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (speakingKey === key) {
      stopSpeech();
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceError("Voice is not available in this browser.");
      return;
    }
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(clean);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice =
      voices.find((v) => /samantha|ava|allison|jenny|aria|google us english/i.test(v.name)) ??
      voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
      null;
    utterance.rate = 0.96;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    utterance.onend = () => {
      utteranceRef.current = null;
      setSpeakingKey((current) => (current === key ? null : current));
    };
    utterance.onerror = () => {
      utteranceRef.current = null;
      setSpeakingKey((current) => (current === key ? null : current));
      setVoiceError("Voice could not start here. Tap again, or check your browser audio settings.");
    };
    utteranceRef.current = utterance;
    setVoiceError("");
    setSpeakingKey(key);
    window.speechSynthesis.speak(utterance);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center" role="dialog" aria-modal="true" aria-label="EILA">
      <div className="sheet-backdrop absolute inset-0 bg-black/55 backdrop-blur-sm sm:bg-black/65" onClick={onClose} />
      {/* Full-screen thread on phones; a tall centered card on desktop. */}
      <div className="chat-panel glass relative z-10 flex h-[100dvh] w-full max-w-app flex-col overflow-hidden sm:my-auto sm:h-[90vh] sm:max-w-lg sm:rounded-[26px]">
        {/* Messaging header — avatar, name, live status, close */}
        <header
          className="flex shrink-0 items-center gap-3 border-b border-fg/10 bg-ink-700/70 px-3 backdrop-blur"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.6rem)", paddingBottom: "0.6rem" }}
        >
          <button onClick={onClose} aria-label="Back" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-fg/70 active:scale-95">
            <ChevronLeft size={22} />
          </button>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent2 text-white shadow-sm">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[15px] font-bold">EILA</div>
            <div className="flex items-center gap-1.5 text-[11px] text-fg/55">
              <span className="h-1.5 w-1.5 rounded-full bg-good" /> Here with you
            </div>
          </div>
        </header>

        {/* Thread */}
        <div ref={scrollRef} className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="flex justify-start">
                <div className="glass max-w-[82%] rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-relaxed text-fg/90">
                  Hey — I&apos;m right here. What&apos;s going on? A deal, a number that looks off, an appointment, or whatever&apos;s on your mind. Say it however it comes out and I&apos;ll sort it.
                </div>
              </div>
              <div className="space-y-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full rounded-full border border-fg/10 bg-fg/[0.03] px-4 py-2 text-left text-[13px] text-fg/60 transition active:scale-[0.99]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            // A trailing empty assistant bubble is the active "she's typing"
            // placeholder; any OTHER empty bubble is just bookkeeping (e.g. the
            // fresh slot opened right after an action card) — skip rendering it.
            const isActiveTrailing = m.role === "assistant" && busy && i === messages.length - 1;
            if (!m.content && !m.images?.length && !isActiveTrailing) return null;

            // Consecutive bubbles from the same side hug closer, like iMessage.
            const prev = messages[i - 1];
            const grouped = prev && prev.role === m.role && (prev.content || "") !== "";

            if (m.role === "action") {
              return (
                <div key={i} className="flex justify-start pt-1">
                  <div className="action-pop glass flex max-w-[88%] items-start gap-2.5 rounded-2xl border border-good/25 bg-good/[0.07] px-3.5 py-2.5 text-[14px] leading-relaxed text-fg/90">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-good/20 text-good">
                      <Check size={13} strokeWidth={3} />
                    </span>
                    {m.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} ${grouped ? "mt-0.5" : "mt-2"}`}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[82%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[15px] leading-relaxed text-white shadow-sm"
                      : "glass max-w-[85%] rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-relaxed text-fg/90"
                  }
                >
                  {m.role === "assistant" ? (
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1 whitespace-pre-wrap">{m.content || <Typing />}</div>
                      {m.content && !isActiveTrailing ? (
                        <button
                          type="button"
                          onClick={() => speak(m.content, i)}
                          className="-mb-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-accent2 transition active:scale-95"
                          aria-label={speakingKey === i ? "Stop EILA voice" : "Read EILA response aloud"}
                        >
                          {speakingKey === i ? <Square size={12} fill="currentColor" /> : <Volume2 size={14} />}
                        </button>
                      ) : null}
                    </div>
                  ) : m.images?.length ? (
                    <div className="space-y-1.5">
                      <div className={`grid gap-1.5 ${m.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                        {m.images.map((im, k) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={k} src={im.dataUrl} alt="Attached photo" className="max-h-56 w-full rounded-xl object-cover" />
                        ))}
                      </div>
                      {m.content ? <div className="whitespace-pre-wrap">{m.content}</div> : null}
                    </div>
                  ) : (
                    m.content || <Typing />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {voiceError && (
          <div className="mx-3 mb-2 rounded-xl bg-warn/10 px-3 py-2 text-xs font-semibold text-warn">
            {voiceError}
          </div>
        )}

        {/* Composer — pinned to the bottom like a keyboard-attached message bar */}
        <div
          className="shrink-0 border-t border-fg/10 bg-ink-700/70 px-3 pt-2.5 backdrop-blur"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.6rem)" }}
        >
          {attachError && (
            <div className="mb-2 rounded-xl bg-warn/10 px-3 py-2 text-xs font-semibold text-warn">{attachError}</div>
          )}

          {/* Pending photos — thumbnails with a tap-to-remove, like a text draft */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, k) => (
                <div key={k} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.dataUrl} alt="Attachment preview" className="h-16 w-16 rounded-xl object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAttachment(k)}
                    aria-label="Remove photo"
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink-900 text-fg/80 shadow ring-1 ring-fg/20 active:scale-95"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); send(input, attachments); }} className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
              className="hidden"
            />
            {/* Attach a photo — on a phone this offers Camera or Photo Library */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a photo"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-fg/60 transition active:scale-95"
            >
              <ImagePlus size={20} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
              }}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter (or the phone return key when the user
                // wants a new line) inserts a newline — standard messaging feel.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!busy && (input.trim() || attachments.length)) send(input, attachments);
                }
              }}
              placeholder="Message EILA…"
              rows={1}
              enterKeyHint="send"
              autoComplete="off"
              className="max-h-32 min-w-0 flex-1 resize-none rounded-[20px] border border-fg/12 bg-fg/[0.04] px-4 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-fg/45 focus:border-accent/40"
            />
            <button
              type="submit"
              disabled={busy || (!input.trim() && !attachments.length)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white transition active:scale-95 disabled:opacity-30"
              aria-label="Send"
            >
              <Send size={17} />
            </button>
          </form>
        </div>
      </div>
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
