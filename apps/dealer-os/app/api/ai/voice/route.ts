import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";

// EILA's voice — ElevenLabs text-to-speech. Takes the text of her reply and
// returns spoken audio (mp3). Auth-gated so only signed-in users can spend TTS
// credits, and length-capped so one reply can't run up cost.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// TTS synthesis of a full reply can take longer than the default timeout on a
// long answer; give it modest headroom so the audio doesn't cut off with a 504.
export const maxDuration = 30;

// EILA's voice — "Hannah": confident and warm, commanding without going cold
// (Aaron picked her July 4, 2026, replacing Zoey — round 2 of the audition,
// brief was "confident, mature, commanding, and still vibrant, young, and
// refreshing"). The audition page can still pass an explicit voiceId to
// preview others.
const DEFAULT_VOICE_ID = "ZSNL4hPqCnqoMPaI4jGX";

export async function POST(req: Request) {
  // Only let signed-in users spend credits. Fail CLOSED in production — refuse if
  // the server client can't be built (skip the gate only in local dev).
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    if (process.env.NODE_ENV === "production") return new NextResponse("Service unavailable", { status: 503 });
  } else {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const { data } = token ? await supabase.auth.getUser(token) : { data: { user: null } as any };
    if (!data?.user) return new NextResponse("Unauthorized", { status: 401 });
  }

  const rl = await rateLimit(clientKey(req), { limit: 30, windowSec: 60 });
  if (!rl.ok) return tooManyRequests(rl);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return new NextResponse("Voice isn't configured", { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { text?: string; voiceId?: string };
  const text = String(body.text || "")
    .replace(/\s+/g, " ")
    // Pronunciation: TTS reads "EILA" as a word ("Eylea"). Her name is EYE-lah —
    // spoken audio only; on-screen text keeps the real spelling.
    .replace(/\bEILA\b/gi, "Eye-la")
    .trim()
    .slice(0, 1200); // cap length = cap cost
  if (!text) return new NextResponse("No text", { status: 400 });
  // Optional explicit voice (the audition page). Validated to an ElevenLabs id
  // shape so the path can't be tampered with; otherwise the default voice.
  const requested = String(body.voiceId || "").trim();
  const voiceId = /^[A-Za-z0-9]{16,32}$/.test(requested) ? requested : DEFAULT_VOICE_ID;

  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          // Turbo = low latency + lower cost, so EILA starts talking fast and
          // stays "lean". Her voice carries across models.
          model_id: "eleven_turbo_v2_5",
          // HIGH stability (0.85) keeps the read controlled and confident
          // rather than breathy/emotional; style 0 (no exaggeration); speed
          // 1.12 so she doesn't drag. Carried over from the Zoey tuning —
          // revisit if Hannah's production read needs its own adjustment.
          voice_settings: { stability: 0.85, similarity_boost: 0.85, style: 0, use_speaker_boost: true, speed: 1.12 },
        }),
      },
    );
    if (!r.ok) {
      const err = await r.text();
      return new NextResponse(`Voice error: ${err.slice(0, 200)}`, { status: 502 });
    }
    const audio = await r.arrayBuffer();
    return new NextResponse(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new NextResponse(`Voice error: ${e instanceof Error ? e.message : "failed"}`, { status: 502 });
  }
}
