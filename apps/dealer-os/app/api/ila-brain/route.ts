import { NextResponse } from "next/server";
import { ilaCore } from "@commissioned41/ila-core/core";
import { isOwnerEmail } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { curateBrainLesson, loadAllBrainLessons, lessonScore } from "@commissioned41/ila-core/brain";

// EILA's main brain — the owner's window into it (Aaron only). GET returns
// every lesson with its track record; POST curates (pin/unpin/delete) or asks
// EILA to write her "what I've learned" digest. The brain itself is shared by
// every C41 product (lib/ila-brain.ts); this is where its owner reads and
// prunes it.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The "what I've learned" digest is a model call that can run past the default
// timeout; give it headroom so writing the digest doesn't 504.
export const maxDuration = 60;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const DIGEST_MODEL = "claude-opus-4-8";

async function ownerOnly(req: Request): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return process.env.NODE_ENV !== "production";
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return false;
  return isOwnerEmail(data.user.email);
}

export async function GET(req: Request) {
  if (!(await ownerOnly(req))) return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const lessons = await loadAllBrainLessons();
  const now = Date.now();
  // ranked the same way her prompts see them: pinned first, then by record
  const ranked = [
    ...lessons.filter((l) => l.pinned),
    ...lessons.filter((l) => !l.pinned).sort((a, b) => lessonScore(b, now) - lessonScore(a, now)),
  ];
  return NextResponse.json({ lessons: ranked });
}

export async function POST(req: Request) {
  if (!(await ownerOnly(req))) return NextResponse.json({ error: "Owner only." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { op?: string; lesson?: string };

  if (body.op === "pin" || body.op === "unpin" || body.op === "delete") {
    const ok = await curateBrainLesson(String(body.lesson || ""), body.op);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Lesson not found." }, { status: 404 });
  }

  if (body.op === "digest") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set." }, { status: 503 });

    const lessons = await loadAllBrainLessons();
    if (!lessons.length) {
      return NextResponse.json({ digest: "My playbook is empty — I haven't distilled any universal lessons yet. Give it a few real conversations across the apps and check back." });
    }
    const weekAgo = Date.now() - 7 * 86_400_000;
    const fmt = (l: (typeof lessons)[number]) =>
      `- "${l.lesson}" (from ${l.source}, ${l.date.slice(0, 10)}; applied ${l.uses ?? 0}x, landed ${l.wins ?? 0}x${l.pinned ? "; PINNED by Aaron" : ""})`;
    const recent = lessons.filter((l) => Date.parse(l.date) >= weekAgo);
    const proven = [...lessons].filter((l) => (l.uses ?? 0) > 0).sort((a, b) => lessonScore(b) - lessonScore(a));
    const struggling = lessons.filter((l) => (l.uses ?? 0) >= 3 && (l.wins ?? 0) / (l.uses ?? 1) < 0.34);

    const system = `${ilaCore("Aaron")}

WHAT YOU DO HERE: Aaron (founder of Commissioned 41, the only person who sees this) asked for your learning digest — what you've taught yourself lately across all his products. Report like a sharp operator reviewing her own growth: what's new this week, which lessons are proving themselves in the field (real uses/wins numbers), anything that's falling flat and should probably go, and what you want to get better at next. Be honest about thin data — a lesson used twice isn't proven. 6-10 sentences, plain text, no headers or bullets.`;

    const user = `LEARNED THIS WEEK (${recent.length}):
${recent.map(fmt).join("\n") || "(nothing new this week)"}

PROVEN IN THE FIELD (by track record):
${proven.slice(0, 8).map(fmt).join("\n") || "(none applied yet)"}

FALLING FLAT (used 3+ times, landing under a third):
${struggling.map(fmt).join("\n") || "(none)"}

TOTAL PLAYBOOK: ${lessons.length} lessons.`;

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: DIGEST_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) return NextResponse.json({ error: "Digest failed." }, { status: 502 });
    const data = await res.json();
    const digest = (data.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();
    return NextResponse.json({ digest });
  }

  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}
