import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { LessonFeedback, loadBrainLessons, recordLessonFeedback, saveBrainLessons } from "@commissioned41/ila-core/brain";

// EILA's learning step. After a chat response finishes streaming, the route
// hands the full conversation here (via next/server's after(), so the user
// never waits on it); EILA distills 0-3 short, durable notes and stores them
// in the IlaMemory table. This is how she learns and evolves from every
// interaction — per-app by design: nothing here leaves Finance.

const MAX_MEMORIES = 40;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const REFLECT_SYSTEM = `You are EILA's memory. You read one conversation between EILA (an AI personal-CFO) and the person she advises, and you write what EILA should carry forward — in two tiers — plus a grade of her playbook.

"personal" — 0-3 notes about THIS PERSON, for future conversations with them only. Durable things: preferences ("wants direct, no fluff"), facts about their life or money habits ("paying for two kids' aftercare", "anniversary July 18"), commitments they made ("said he'd cancel the unused gym membership"), what advice landed or fell flat. NEVER transient numbers (today's balance, this month's spend — EILA always has those live). NEVER duplicate anything in the ALREADY-KNOWN list.

"lessons" — 0-2 UNIVERSAL lessons about the craft of coaching people on money, worth applying to ANYONE. A lesson must contain NO names, NO personal details, NO specifics of this person's situation — only generalizable technique ("framing a purchase as days of safety-net coverage lands harder than a percentage"). Most conversations produce NONE — an empty list is the normal outcome. Never restate a personal note as a lesson, and NEVER add a lesson that duplicates or merely rephrases a PLAYBOOK lesson.

"feedback" — for each numbered PLAYBOOK lesson EILA VISIBLY APPLIED in this conversation (the technique clearly shows in what she said), one entry {"n": <number>, "landed": true|false|null}. landed=true if the person engaged, agreed, or acted on it; false if it clearly fell flat or was rejected; null if you can't tell. Do NOT include lessons she didn't use — an empty list is the normal outcome.

Each personal/lesson entry is one plain sentence, under 25 words, no app names, no meta-commentary.

Respond with ONLY a JSON object: {"personal": [...], "lessons": [...], "feedback": [...]}. No prose, no markdown fence.`;

export async function reflectAndRemember(messages: ChatMessage[]): Promise<void> {
  try {
    const known = await prisma.ilaMemory.findMany({
      orderBy: { createdAt: "desc" },
      take: MAX_MEMORIES,
    });

    const transcript = messages
      .slice(-20)
      .map((m) => `${m.role === "user" ? "USER" : "EILA"}: ${m.content.slice(0, 2000)}`)
      .join("\n\n");

    // The playbook lessons EILA had in front of her for this conversation —
    // graded so lessons build a track record.
    const playbook = await loadBrainLessons();

    const user = `ALREADY KNOWN (do not repeat):
${known.map((k) => `- ${k.note}`).join("\n") || "- (nothing yet)"}

PLAYBOOK (grade only these, by number):
${playbook.map((l, i) => `${i + 1}. ${l.lesson}`).join("\n") || "(empty)"}

CONVERSATION:
${transcript}`;

    const client = new Anthropic();
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: REFLECT_SYSTEM,
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
        const obj = parsed as Record<string, unknown>;
        notes = clean(obj.personal, 3);
        lessons = clean(obj.lessons, 2);
        if (Array.isArray(obj.feedback)) {
          feedback = (obj.feedback as { n?: unknown; landed?: unknown }[])
            .filter((f) => !!f && typeof f.n === "number" && f.n >= 1 && f.n <= playbook.length)
            .map((f) => ({
              lesson: playbook[(f.n as number) - 1].lesson,
              landed: f.landed === true ? true : f.landed === false ? false : null,
            }));
        }
      }
    } catch {
      return; // a malformed reflection just means nothing learned this time
    }

    // Brain updates — new lessons in, track records updated (we're already
    // running post-response inside after(), so these awaits cost the user nothing)
    if (lessons.length) await saveBrainLessons(lessons, "finance");
    if (feedback.length) await recordLessonFeedback(feedback);

    const seen = new Set(known.map((k) => k.note.trim().toLowerCase()));
    const fresh = notes.filter((n) => !seen.has(n.toLowerCase()));
    if (!fresh.length) return;

    await prisma.ilaMemory.createMany({ data: fresh.map((note) => ({ note })) });

    // keep her memory sharp: drop the oldest past the cap
    const count = await prisma.ilaMemory.count();
    if (count > MAX_MEMORIES) {
      const excess = await prisma.ilaMemory.findMany({
        orderBy: { createdAt: "asc" },
        take: count - MAX_MEMORIES,
        select: { id: true },
      });
      await prisma.ilaMemory.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } });
    }
  } catch (e) {
    console.error("[ila/reflect] failed:", e); // learning must never break chat
  }
}
