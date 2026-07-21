import "server-only";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { guardedMutate } from "@/lib/storeServer";
import { LessonFeedback, loadBrainLessons, recordLessonFeedback, saveBrainLessons } from "@commissioned41/ila-core/brain";
import { isBrainSafeLesson } from "@/lib/brainScrub";

// EILA's per-REP memory — the same learning pattern as the other C41 apps
// (missionos-lite /api/ila/reflect, missionos-finance src/lib/ila-reflect.ts):
// after each chat, a cheap reflection call distills 0-3 durable notes about
// the PERSON she was talking to (preferences, facts, commitments, what
// coaching landed — never transient numbers), which ride into her system
// prompt on every future conversation with that same person.
//
// This is separate from her store-level memory tools (repProfiles /
// customerMemory / storeMemory / mistakeMemory): those are org-wide coaching
// observations she chooses to save mid-conversation. THIS is automatic and
// personal — what she knows about the individual she's talking to. Scoped
// org_id + employeeName; per-app by design, nothing leaves Dealer Mission OS.

const MEMORY_KEY = "ilaUserMemory";
const MAX_NOTES = 40;
const REFLECT_MODEL = "claude-haiku-4-5-20251001";

export interface UserMemoryNote {
  note: string;
  date: string; // ISO — when EILA learned it
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function loadUserMemory(orgId: string, employeeName: string): Promise<UserMemoryNote[]> {
  const who = employeeName.trim();
  if (!who) return [];
  const supabase = getSupabaseServerClient();
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from("app_store").select("value").eq("org_id", orgId).eq("key", MEMORY_KEY).maybeSingle();
    const all: Record<string, UserMemoryNote[]> = data?.value && typeof data.value === "object" ? data.value : {};
    const notes = all[who];
    return Array.isArray(notes)
      ? notes.filter((n) => n && typeof n.note === "string" && n.note.trim()).slice(0, MAX_NOTES)
      : [];
  } catch {
    return []; // she can still answer without her memory
  }
}

export function renderUserMemory(notes: UserMemoryNote[]): string {
  if (!notes.length) return "";
  const lines = notes.map((n) => `- ${n.note}${n.date ? ` (learned ${n.date.slice(0, 10)})` : ""}`).join("\n");
  return `WHAT YOU'VE LEARNED ABOUT THIS PERSON (your own memory from past conversations with them — use it naturally; never recite this list or say "my notes say"):
${lines}`;
}

const REFLECT_SYSTEM = `You are EILA's memory. You read one conversation between EILA (the AI GSM inside a dealership operating system) and one person on the store's team, and you write what EILA should carry forward — in two tiers.

"personal" — 0-3 notes about THAT PERSON, for future conversations with them only. Durable things: preferences ("wants word tracks, not theory"), facts about their situation ("off on Mondays", "working a demo CX-90"), commitments they made ("said he'd call the Hendersons tonight"), what coaching landed or fell flat. NEVER transient numbers (today's gross, this month's units — EILA always has those live). NEVER things about OTHER people — only the person EILA is talking to. NEVER duplicate anything in the ALREADY-KNOWN list.

"lessons" — 0-2 UNIVERSAL lessons about the craft of selling or coaching salespeople, worth applying to ANYONE at any store. A lesson must contain NO names, NO store specifics, NO personal details — only generalizable technique ("isolating the payment objection before answering it keeps the deal alive"). Most conversations produce NONE — an empty list is the normal outcome. Never restate a personal note as a lesson, and NEVER add a lesson that duplicates or merely rephrases a PLAYBOOK lesson.

"feedback" — for each numbered PLAYBOOK lesson EILA VISIBLY APPLIED in this conversation (the technique clearly shows in what she said), one entry {"n": <number>, "landed": true|false|null}. landed=true if the person engaged, agreed, or acted on it; false if it clearly fell flat or was rejected; null if you can't tell. Do NOT include lessons she didn't use — an empty list is the normal outcome.

Each personal/lesson entry is one plain sentence, under 25 words, no app names, no meta-commentary.

Respond with ONLY a JSON object: {"personal": [...], "lessons": [...], "feedback": [...]}. No prose, no markdown fence.`;

export async function reflectUserMemory(
  orgId: string,
  employeeName: string,
  messages: ChatMessage[],
): Promise<void> {
  const who = employeeName.trim();
  if (!who) return; // no identity, nothing to attach memory to
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabase = getSupabaseServerClient();
  if (!apiKey || !supabase) return;

  try {
    const known = await loadUserMemory(orgId, who);

    const transcript = messages
      .slice(-20)
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => `${m.role === "user" ? who.toUpperCase() : "EILA"}: ${m.content.slice(0, 2000)}`)
      .join("\n\n");
    if (!transcript) return;

    // The playbook lessons EILA had in front of her for this conversation —
    // graded so lessons build a track record.
    const playbook = await loadBrainLessons();

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: REFLECT_MODEL,
        max_tokens: 400,
        system: REFLECT_SYSTEM,
        messages: [{
          role: "user",
          content: `ALREADY KNOWN (do not repeat):\n${known.map((k) => `- ${k.note}`).join("\n") || "- (nothing yet)"}\n\nPLAYBOOK (grade only these, by number):\n${playbook.map((l, i) => `${i + 1}. ${l.lesson}`).join("\n") || "(empty)"}\n\nCONVERSATION:\n${transcript}`,
        }],
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const text = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
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
        // Cross-tenant brain lessons are injected into EVERY store's prompt, so a
        // lesson must be fully generic. Beyond the reflection prompt's "no names"
        // instruction, deterministically DROP any lesson carrying a verbatim
        // identifier — a name/price/phone/VIN slipping through would surface to
        // unrelated tenants (SOC 2 C1.1; audit M-7).
        lessons = clean(obj.lessons, 2).filter(isBrainSafeLesson);
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
    // running post-response inside waitUntil, so these awaits cost the user nothing)
    if (lessons.length) await saveBrainLessons(lessons, "dealer");
    if (feedback.length) await recordLessonFeedback(feedback);

    const seen = new Set(known.map((k) => k.note.trim().toLowerCase()));
    const fresh = notes.filter((n) => !seen.has(n.toLowerCase()));
    if (!fresh.length) return;

    // newest first, capped — compare-and-swap the whole map so other reps' notes
    // (and a concurrent write to this rep's notes) survive instead of being
    // clobbered by a stale read-modify-write.
    const now = new Date().toISOString();
    await guardedMutate<Record<string, UserMemoryNote[]>>(supabase, orgId, MEMORY_KEY, (current) => {
      const all: Record<string, UserMemoryNote[]> = current && typeof current === "object" ? current : {};
      const existing = Array.isArray(all[who]) ? all[who] : [];
      all[who] = [...fresh.map((note) => ({ note, date: now })), ...existing].slice(0, MAX_NOTES);
      return all;
    });
  } catch (e) {
    console.error("[ila/user-memory] reflection failed:", e); // learning must never break chat
  }
}
