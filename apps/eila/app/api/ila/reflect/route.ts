import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { ilaConfigured } from "@/lib/ila";
import { LessonFeedback, loadBrainLessons, recordLessonFeedback, saveBrainLessons } from "@commissioned41/ila-core/brain";
import { rateLimited } from "@/lib/rateLimit";

// EILA's learning step — two tiers. After a chat exchange finishes, the client
// posts the conversation here; EILA distills (a) 0-3 PERSONAL notes about this
// rep (facts, preferences, commitments — never transient numbers), which the
// client stores in the user's synced AppData, per-app by design; and (b) 0-2
// universal LESSONS about the craft, which go up to her shared main brain
// (lib/ila-brain.ts) so every Commissioned 41 product gets sharper together.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL; // any Vercel deploy (previews too) enforces the gate — only true local dev gets the convenience pass

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const email = await getSessionEmail(token);
  if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  if (await rateLimited(`ila-reflect:${email}`, RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  let active = false;
  try {
    active = await hasActiveSubscription(email);
  } catch (e) {
    console.error("[ila/reflect] subscription check failed:", e);
    active = false;
  }
  if (!active && IS_PROD) {
    return NextResponse.json({ error: "Subscription required." }, { status: 402 });
  }

  if (!ilaConfigured()) {
    return NextResponse.json({ error: "EILA is not configured." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    messages?: ChatMessage[];
    known?: string[];
  };

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20);
  if (messages.length === 0) {
    return NextResponse.json({ error: "Nothing to reflect on." }, { status: 400 });
  }

  const known = (Array.isArray(body.known) ? body.known : [])
    .filter((k) => typeof k === "string" && k.trim())
    .slice(0, 40)
    .map((k) => k.trim().slice(0, 300));

  const transcript = messages
    .map((m) => `${m.role === "user" ? "REP" : "EILA"}: ${m.content.slice(0, 2000)}`)
    .join("\n\n");

  // The playbook lessons EILA had in front of her for this conversation — the
  // reflector grades which ones she visibly applied and whether they landed,
  // so lessons build a track record.
  const playbook = await loadBrainLessons();

  const system = `You are EILA's memory. You read one conversation between EILA (a Commissioned 41 synthetic life and performance intelligence) and the rep she coaches, and you write what EILA should carry forward — in two tiers — plus a grade of her playbook.

"personal" — 0-3 notes about THIS REP, for future conversations with them only. Durable things: preferences ("wants direct, no fluff"), non-sensitive facts about their work situation ("works Saturdays, off Mondays"), commitments they made ("said he'd call Priya today"), what coaching landed or fell flat, people/deals that matter beyond today. NEVER transient numbers (today's pace, this month's totals — EILA always has those live). NEVER duplicate anything in the ALREADY-KNOWN list.

Sensitive-memory rule for the current product: there is not yet a memory-confirmation screen. Until that exists, DO NOT store high-sensitivity life facts as personal memory. High-sensitivity facts include exact income, debt, bank balances, family conflict, private relationship details, health details, spiritual confessions, temptations, trauma, secrets, legal issues, passwords, access codes, or anything the rep clearly would not expect to become durable memory. If a sensitive thing matters, store only a safe preference or commitment, not the private detail. Example: store "wants prayer reminders before work when he asks for them," not the content of a confession.

Life-companion rule: EILA is sales-first but not sales-only. A personal note may cover work rhythm, communication preference, sales pattern, money setup preference, habit preference, relationship promise, or faith routine ONLY when it is non-sensitive, durable, useful, and clearly supported by the conversation.

"lessons" — 0-2 UNIVERSAL lessons about the craft of coaching commission professionals, worth applying to ANYONE in any industry. A lesson must contain NO names, NO personal details, NO specifics of this rep's situation — only generalizable technique ("checking on a stated commitment first thing next session lands well"). Most conversations produce NONE — an empty list is the normal outcome. Never restate a personal note as a lesson, and NEVER add a lesson that duplicates or merely rephrases a PLAYBOOK lesson.

"feedback" — for each numbered PLAYBOOK lesson EILA VISIBLY APPLIED in this conversation (the technique clearly shows in what she said), one entry {"n": <number>, "landed": true|false|null}. landed=true if the rep engaged, agreed, or acted on it; false if it clearly fell flat or was rejected; null if you can't tell. Do NOT include lessons she didn't use — an empty list is the normal outcome.

Each personal/lesson entry is one plain sentence, under 25 words, no app names, no meta-commentary.

Respond with ONLY a JSON object: {"personal": [...], "lessons": [...], "feedback": [...]}. No prose, no markdown fence.`;

  const user = `ALREADY KNOWN (do not repeat):
${known.map((k) => `- ${k}`).join("\n") || "- (nothing yet)"}

PLAYBOOK (grade only these, by number):
${playbook.map((l, i) => `${i + 1}. ${l.lesson}`).join("\n") || "(empty)"}

CONVERSATION:
${transcript}`;

  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let notes: string[] = [];
    let lessons: string[] = [];
    let feedback: LessonFeedback[] = [];
    try {
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      const clean = (arr: unknown, cap: number) =>
        Array.isArray(arr)
          ? arr
              .filter((n): n is string => typeof n === "string" && !!n.trim())
              .slice(0, cap)
              .map((n) => n.trim().slice(0, 300))
          : [];
      if (Array.isArray(parsed)) {
        notes = clean(parsed, 3); // tolerate the old array-only shape
      } else if (parsed && typeof parsed === "object") {
        notes = clean(parsed.personal, 3);
        lessons = clean(parsed.lessons, 2);
        if (Array.isArray(parsed.feedback)) {
          feedback = parsed.feedback
            .filter((f: unknown): f is { n: number; landed: boolean | null } => {
              const o = f as { n?: unknown };
              return !!f && typeof o.n === "number" && o.n >= 1 && o.n <= playbook.length;
            })
            .map((f: { n: number; landed: boolean | null }) => ({
              lesson: playbook[f.n - 1].lesson,
              landed: f.landed === true ? true : f.landed === false ? false : null,
            }));
        }
      }
    } catch {
      notes = []; // a malformed reflection just means nothing learned this time
    }

    // Brain updates — new lessons in, track records updated. This route is
    // already fire-and-forget from the client's perspective (the chat never
    // waits on it), so small inline awaits cost nothing user-visible — and
    // this repo is Next 14, which has no after().
    if (lessons.length) await saveBrainLessons(lessons, "lite");
    if (feedback.length) await recordLessonFeedback(feedback);

    return NextResponse.json({ ok: true, notes });
  } catch (e) {
    console.error("[ila/reflect] failed:", e);
    return NextResponse.json({ error: "Reflection failed." }, { status: 500 });
  }
}
