"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Gift, Phone, Play, ScanLine, Sparkles, Target, Volume2, VolumeX } from "lucide-react";
import { MissionMark } from "@/components/Brand";

// EILA's guided tour — the "demo video" that never goes stale because it's
// built from the product's own design system and narrated by EILA's real
// voice (pre-generated Hannah clips in /public/demo, regenerated July 4, 2026
// when her voice changed from Zoey — never let this drift out of sync with
// the production voice again). Public page: prospects get the link, tap
// play, and watch the whole story in about a minute.
// Audio needs a user gesture on iOS, so the tour starts from a tap and the
// single <audio> element is blessed by it. Muted mode advances on a timer
// and the captions carry the story (reduced-motion safe throughout).

interface Step {
  id: string;
  caption: string;
  fallbackMs: number; // auto-advance when muted / audio fails
  screen: React.ReactNode;
}

const AD_COUNT = 10; // frames in the ?ad=N commercial set below

export default function DemoPage() {
  const [started, setStarted] = useState(false);
  const [videoFrame, setVideoFrame] = useState<number | null>(null);
  const [adFrame, setAdFrame] = useState<number | null>(null);
  const [i, setI] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // iOS only allows audio that starts INSIDE a user tap — so start() plays the
  // first clip itself, and this flag tells the effect not to restart it.
  const playedInGesture = useRef(false);
  // Bumped on every run of the narration effect below. el.play() is a
  // floating promise — if someone taps through steps fast enough, an OLD
  // step's play() can still resolve/reject after a NEWER step has already
  // taken over the audio element. Its callback checks this against the
  // generation it captured at effect-run time and no-ops if it's stale,
  // instead of arming a backstop off the wrong step's closure (audit finding,
  // July 5).
  const tourGen = useRef(0);

  const steps = useMemo<Step[]>(() => [
    {
      id: "1-intro",
      caption: "Meet EILA — your AI assistant.",
      fallbackMs: 6500,
      screen: (
        <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
          <MissionMark width={110} />
          <div>
            <div className="font-display text-3xl font-black">Meet EILA.</div>
            <div className="mt-2 text-sm leading-relaxed text-fg/60">Run your day. Log your deals.<br />Know what your money is doing.</div>
          </div>
        </div>
      ),
    },
    {
      id: "2-setup",
      caption: "Pick your industry and role — EILA speaks your language.",
      fallbackMs: 7500,
      screen: (
        <div className="flex h-full flex-col justify-center gap-3 p-6">
          <div className="px-1 text-lg font-bold">What industry are you in?</div>
          <div className="flex flex-wrap gap-2">
            {["Real Estate", "Automotive", "Insurance", "Jewelry", "Mortgage", "Solar & Roofing"].map((x, n) => (
              <span key={x} className={`rounded-xl px-3.5 py-2.5 text-sm font-semibold ${n === 0 ? "bg-accent text-white" : "bg-fg/6 text-fg/70"}`}>{x}</span>
            ))}
          </div>
          <div className="mt-3 px-1 text-lg font-bold">Your role</div>
          <span className="w-fit rounded-xl bg-accent px-3.5 py-2.5 text-sm font-semibold text-white">Individual Producer</span>
        </div>
      ),
    },
    {
      id: "3-payplan",
      caption: "Upload your pay plan — EILA reads splits, tiers, and bonuses.",
      fallbackMs: 9500,
      screen: (
        <div className="flex h-full flex-col justify-center gap-4 p-6">
          <div className="glass p-4">
            <div className="text-sm font-bold">Add your pay plan</div>
            <div className="mt-1 text-xs text-fg/70">PDF · Image · Word · Text</div>
            <div className="mt-3 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-center text-sm font-semibold text-accent">acme-comp-2026.pdf</div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-good/10 px-3.5 py-2.5 text-sm font-semibold text-good">
            <Check size={15} /> Read ✓ — 70% split · rises to 85% · monthly goal 3
          </div>
        </div>
      ),
    },
    {
      id: "4-dashboard",
      caption: "Your Home screen: a warm read on your money, pace, and day.",
      fallbackMs: 10500,
      screen: (
        <div className="flex h-full flex-col justify-center gap-3 p-5">
          <div className="glass living-ring p-4">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent2"><Sparkles size={12} /> Likely commission</div>
            <div className="mt-1 text-4xl font-black tabnum">$26,067</div>
            <div className="mt-2 flex items-center gap-2 text-xs text-fg/55">
              <span className="rounded-full bg-good/15 px-2 py-0.5 text-good">$10,990 earned</span>
              <span>· 74% confidence</span>
            </div>
          </div>
          <div className="glass flex gap-3 p-3.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Target size={17} /></div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/65">Today&apos;s focus</div>
              <div className="mt-0.5 text-[13px] leading-snug text-fg/90">Start with the warmest deal, then add one clean appointment.</div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "5-logdeal",
      caption: "Log a deal in under a minute — or scan the customer's ID.",
      fallbackMs: 8500,
      screen: (
        <div className="flex h-full flex-col justify-center gap-3 p-5">
          <div className="glass space-y-3 p-4">
            <div className="text-sm font-bold">Log a deal</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-fg/6 px-3 py-2.5 text-sm text-fg/80">Marcus Bell</div>
              <div className="rounded-xl bg-fg/6 px-3 py-2.5 text-sm text-fg/80">412 Maple St</div>
            </div>
            <div className="flex items-center justify-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-sm font-semibold text-accent">
              <ScanLine size={15} /> Scan customer ID
            </div>
            <div className="text-xs font-semibold text-good">Read ✓ Marcus Bell · Kennesaw, GA</div>
          </div>
        </div>
      ),
    },
    {
      id: "6-followup",
      caption: "The Day board: life reminders, customer touches, and one-tap EILA help.",
      fallbackMs: 10000,
      screen: (
        <div className="flex h-full flex-col justify-center gap-2.5 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-warn">Overdue · 1</div>
          <div className="glass living-ring p-3.5">
            <div className="text-sm font-semibold">Sofia Marin</div>
            <div className="text-xs text-fg/70">412 Maple St · Appointment · <span className="text-warn">yesterday</span></div>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="btn btn-primary !flex-1 !py-2 !text-[12px]"><Sparkles size={13} /> Draft with EILA</span>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-good/15 text-good"><Phone size={14} /></span>
            </div>
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-accent2">Customer touches · 2</div>
          <div className="glass p-3.5">
            <div className="text-sm font-semibold">Andre Cole</div>
            <div className="text-xs text-fg/70">88 Lakeview Dr · Under contract · <span className="text-accent2">today</span></div>
          </div>
        </div>
      ),
    },
    {
      id: "7-chat",
      caption: "Ask EILA anything — she knows your numbers and remembers you.",
      fallbackMs: 9000,
      screen: (
        <div className="flex h-full flex-col justify-center gap-3 p-5">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-accent/20 px-3.5 py-2.5 text-sm">Am I going to hit my goal this month?</div>
          <div className="glass max-w-[92%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm leading-relaxed text-fg/85">
            You&apos;re pacing 5 against your goal of 4 — ahead, and it&apos;s only day 12. Protect it: Sofia&apos;s been quiet three days, and she&apos;s your biggest live deal. Want me to build today&apos;s plan around her and your appointments?
          </div>
        </div>
      ),
    },
    {
      id: "8-money",
      caption: "She watches your money too — bills, safe-to-spend, goals.",
      fallbackMs: 11000,
      screen: (
        <div className="flex h-full flex-col justify-center gap-2.5 p-5">
          <div className="glass living-ring p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-fg/55">Safe to spend</div>
            <div className="mt-0.5 font-display text-2xl font-black tabnum text-good">$3,024</div>
            <div className="text-[11px] text-fg/55">$336/day until your check lands</div>
          </div>
          <div className="glass max-w-[95%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[13px] leading-relaxed text-fg/85">
            Rent&apos;s covered, truck payment is 14 days out — handled. Close Thursday&apos;s deal and the anniversary trip is funded. 🎯
          </div>
          <div className="rounded-2xl border-2 border-dashed border-accent/40 bg-accent/[0.05] p-3 text-center">
            <div className="text-[12px] font-bold">Drop in a bank statement</div>
            <div className="text-[10px] text-fg/55">she learns your bills and spending — automatically</div>
          </div>
        </div>
      ),
    },
    {
      id: "9-close",
      caption: "Feel clear, supported, and ready for the day.",
      fallbackMs: 8000,
      screen: (
        <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
          <MissionMark width={90} />
          <div className="flex items-end justify-center gap-1.5">
            <span className="font-display text-4xl font-black tabnum leading-none">$19.99</span>
            <span className="pb-1 text-sm text-fg/50">/ month</span>
          </div>
          <Link href="/subscribe" className="btn btn-primary w-full max-w-[240px]">
            <Gift size={16} /> Get started <ArrowRight size={16} />
          </Link>
          <div className="text-xs text-fg/65">Cancel anytime · secure checkout by Stripe</div>
        </div>
      ),
    },
  ], []);

  const step = steps[i];

  // ?frame=N renders one step as a static 1080×1920 video frame — the MP4
  // pipeline screenshots these with headless Chrome and ffmpeg stitches them
  // to EILA's narration. Not linked anywhere; harmless if a human finds it.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const f = q.get("frame");
      if (f !== null) setVideoFrame(Math.max(0, Math.min(parseInt(f, 10) || 0, steps.length - 1)));
      const a = q.get("ad");
      if (a !== null) setAdFrame(Math.max(0, Math.min(parseInt(a, 10) || 0, AD_COUNT - 1)));
    } catch {}
  }, [steps.length]);

  // Play the step's narration; advance when it ends (or on a timer if muted).
  //
  // The backstop timer exists so a stalled/blocked clip can never hang the
  // tour in silence forever — but it used to guess each step's length by
  // hand (`step.fallbackMs`, 6.5–10.5s, authored for an older, longer
  // narration draft). The actual clips are all under 4.5s, so whenever
  // playback DID stall (a network hiccup, or a browser silently blocking a
  // timer-initiated play() — real risks on mobile Safari), the tour went
  // dead for the gap between the real clip length and that oversized guess:
  // up to ~7 seconds of nothing (Aaron caught this live, July 4). Fixed by
  // reading the clip's REAL duration off the loaded audio the moment it's
  // known and re-arming the backstop tight to that — worst case is now
  // "actual clip length + 2.5s," never a multi-second guess.
  useEffect(() => {
    if (!started) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    tourGen.current += 1;
    const myGen = tourGen.current;
    const stale = () => tourGen.current !== myGen;
    const el = audioRef.current;
    const advance = () => setI((n) => Math.min(n + 1, steps.length - 1));
    const last = i === steps.length - 1;
    const armBackstop = (ms: number) => {
      if (stale()) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (!last) timerRef.current = setTimeout(advance, ms);
    };

    if (!muted && el) {
      setSpeaking(true);
      el.onended = () => { if (timerRef.current) clearTimeout(timerRef.current); setSpeaking(false); if (!last) timerRef.current = setTimeout(advance, 500); };
      el.onerror = () => { setSpeaking(false); armBackstop(2500); };
      // Real duration is known almost immediately (just needs the file
      // header, not the whole clip) — tighten the backstop the instant it
      // fires, well before the clip finishes playing.
      el.onloadedmetadata = () => { if (Number.isFinite(el.duration)) armBackstop(el.duration * 1000 + 2500); };
      if (playedInGesture.current) {
        // Step 1 is already playing from the tap itself — just steer it.
        playedInGesture.current = false;
        armBackstop((Number.isFinite(el.duration) ? el.duration * 1000 : step.fallbackMs) + 2500);
      } else {
        el.src = `/demo/${step.id}.mp3`;
        el.load();
        // Guard against a stale generation: if the user taps through steps
        // fast enough, this promise can still resolve/reject after a NEWER
        // step has already taken over the audio element — a bare .catch()
        // would otherwise arm a backstop off this run's stale `last`/`step`
        // closure (audit finding, July 5).
        el.play().catch(() => { if (stale()) return; setSpeaking(false); armBackstop(2500); });
        // Generic guess until onloadedmetadata (above) replaces it with the
        // real clip length — this is just the safety net for a file that
        // fails to load at all.
        armBackstop(step.fallbackMs);
      }
    } else {
      setSpeaking(false);
      armBackstop(step.fallbackMs);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, i, muted]);

  // ?ad=N — cinematic 1080×1920 frames for the EILA commercial (Apple-spot
  // style: huge type, one idea per frame, floating product glass, black
  // negative space). ffmpeg adds the motion — slow push-ins + crossfades.
  if (adFrame !== null) {
    const Screen = ({ title, screen }: { title: string; screen: React.ReactNode }) => (
      <main className="flex h-[1920px] w-[1080px] flex-col items-center overflow-hidden px-16 pt-40">
        <h1 className="font-display text-center text-[84px] font-black leading-[1.06] tracking-tight" style={{ textWrap: "balance" }}>{title}</h1>
        <div className="glass living-ring mt-20 shrink-0 overflow-hidden rounded-[60px]" style={{ width: 900, height: 1220 }}>
          <div style={{ width: 900 / 2.1, height: 1220 / 2.1, transform: "scale(2.1)", transformOrigin: "top left" }}>
            <div className="h-full w-full">{screen}</div>
          </div>
        </div>
      </main>
    );
    const Card = ({ children }: { children: React.ReactNode }) => (
      <main className="flex h-[1920px] w-[1080px] flex-col items-center justify-center overflow-hidden px-20 text-center">{children}</main>
    );
    const H = ({ children, size = 104 }: { children: React.ReactNode; size?: number }) => (
      <h1 className="font-display font-black tracking-tight" style={{ fontSize: size, lineHeight: 1.08, textWrap: "balance" }}>{children}</h1>
    );
    const ads: React.ReactNode[] = [
      <Card key="0"><H>Paid on commission?</H></Card>,
      <Card key="1"><H size={92}>Your numbers shouldn&apos;t live <span className="text-fg/65">in your head.</span></H></Card>,
      <Card key="2">
        <MissionMark width={250} />
        <div className="mt-16"><H size={130}>Meet EILA.</H></div>
        <div className="mt-8 text-[40px] font-semibold text-fg/70">Your AI assistant.</div>
      </Card>,
      <Screen key="3" title="Know your check. Every day." screen={steps[3].screen} />,
      <Screen key="4" title="Log a deal in seconds." screen={steps[4].screen} />,
      <Screen key="5" title="Your whole day, clear." screen={steps[5].screen} />,
      <Screen key="6" title="Ask her anything." screen={steps[6].screen} />,
      <Card key="7">
        <H size={110}>Any industry.</H>
        <div className="mt-10 text-[44px] font-semibold leading-snug text-fg/70">Real estate. Auto. Insurance.<br />Jewelry. Yours.</div>
      </Card>,
      <Card key="8">
        <MissionMark width={190} />
        <div className="mt-16"><H size={88}>Run your day.<br /><span className="text-accent">Know your money.</span></H></div>
      </Card>,
      <Card key="9">
        <H size={170}>EILA</H>
        <div className="mt-10 text-[42px] font-semibold text-fg/50">Start your day clear.</div>
        <div className="mt-24 text-[36px] font-semibold tracking-wide text-fg/60">lite.commissioned41.com</div>
      </Card>,
    ];
    return <>{ads[Math.min(adFrame, ads.length - 1)]}</>;
  }

  if (videoFrame !== null) {
    const s = steps[videoFrame];
    return (
      <main className="flex h-[1920px] w-[1080px] flex-col overflow-hidden px-16 py-20">
        <div className="flex items-center gap-5">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-accent/15"><Sparkles size={38} className="text-accent2" /></span>
          <div>
            <div className="text-4xl font-black leading-none">EILA</div>
            <div className="mt-1.5 text-xl text-fg/65">Your AI assistant</div>
          </div>
        </div>
        {/* The step screen is authored at phone size; render it into an exact
            phone-sized box and scale it up to fill the frame — origin top-left
            with width/height pre-divided so it lands pixel-perfect. */}
        <div className="glass living-ring mt-14 overflow-hidden rounded-[56px]" style={{ width: 952, height: 1280 }}>
          <div style={{ width: 952 / 2.2, height: 1280 / 2.2, transform: "scale(2.2)", transformOrigin: "top left" }}>
            <div className="h-full w-full">{s.screen}</div>
          </div>
        </div>
        <p className="mt-14 text-center text-[44px] font-bold leading-snug text-fg/90" style={{ textWrap: "balance" }}>{s.caption}</p>
        <div className="mt-10 flex items-center justify-center gap-3">
          {steps.map((x, n) => (
            <span key={x.id} className={`h-3 rounded-full ${n === videoFrame ? "w-12 bg-accent" : "w-3 bg-fg/20"}`} />
          ))}
        </div>
      </main>
    );
  }


  function start() {
    // Play the FIRST narration inside the tap itself — iOS blesses the element
    // through this play, and the same element carries every later clip.
    const el = new Audio();
    audioRef.current = el;
    el.src = `/demo/${steps[0].id}.mp3`;
    el.play().then(() => { playedInGesture.current = true; }).catch(() => { playedInGesture.current = false; });
    playedInGesture.current = true;
    setStarted(true);
  }
  function stopAudio() { const el = audioRef.current; if (el) { el.onended = null; el.pause(); } if (timerRef.current) clearTimeout(timerRef.current); }
  function go(n: number) { stopAudio(); setI(Math.max(0, Math.min(n, steps.length - 1))); }

  if (!started) {
    return (
      <main className="grid min-h-[100dvh] place-items-center px-5">
        <div className="glass living-ring w-full max-w-md rounded-[26px] p-8 text-center">
          <MissionMark width={90} className="mx-auto" />
          <h1 className="mt-5 font-display text-2xl font-black">See how EILA works</h1>
          <p className="mt-2 text-sm leading-relaxed text-fg/60">A one-minute guided tour — narrated by EILA herself.</p>
          <button onClick={start} className="btn btn-primary mt-6 w-full">
            <Play size={16} /> Take the tour
          </button>
          <Link href="/subscribe" className="mt-4 block text-center text-sm text-fg/70 underline-offset-2 hover:underline">Skip to sign-up</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 pb-8 pt-6">
      {/* header: EILA "speaking" indicator + mute */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-9 w-9 place-items-center rounded-full bg-accent/15 ${speaking ? "motion-safe:animate-pulse" : ""}`}>
            <Sparkles size={17} className="text-accent2" />
          </span>
          <div>
            <div className="text-sm font-bold leading-none">EILA</div>
            <div className="mt-0.5 text-[11px] text-fg/65">{speaking ? "speaking…" : "guided tour"}</div>
          </div>
        </div>
        <button onClick={() => { stopAudio(); setMuted((m) => !m); }} aria-label={muted ? "Unmute" : "Mute"}
          className="grid h-9 w-9 place-items-center rounded-full bg-fg/6 text-fg/55 active:scale-95">
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      </div>

      {/* the "phone screen" */}
      <div className="glass living-ring mt-5 flex-1 overflow-hidden rounded-[26px]" style={{ minHeight: 420 }}>
        <div key={step.id} className="h-full rise">{step.screen}</div>
      </div>

      {/* caption */}
      <p className="mt-4 min-h-[3rem] text-center text-[15px] font-medium leading-snug text-fg/85" aria-live="polite">{step.caption}</p>

      {/* progress + controls */}
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {steps.map((s, n) => (
          <button key={s.id} onClick={() => go(n)} aria-label={`Step ${n + 1}`}
            className={`h-1.5 rounded-full transition-all ${n === i ? "w-6 bg-accent" : "w-1.5 bg-fg/20"}`} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="Back"
          className="grid h-11 w-11 place-items-center rounded-full bg-fg/6 text-fg/60 active:scale-95 disabled:opacity-30">
          <ChevronLeft size={20} />
        </button>
        {i === steps.length - 1 ? (
          <Link href="/subscribe" className="btn btn-primary !px-6">Get started <ArrowRight size={15} /></Link>
        ) : (
          <button onClick={() => go(i + 1)} aria-label="Next"
            className="grid h-11 w-11 place-items-center rounded-full bg-accent text-white active:scale-95">
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </main>
  );
}
