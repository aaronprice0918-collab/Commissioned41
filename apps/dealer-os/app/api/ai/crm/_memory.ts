import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { guardedMutate } from "@/lib/storeServer";

// EILA's persistent coaching memory: one profile per rep, accumulated over
// time, scoped to the caller's store.
export async function saveRepObservation(input: any, orgId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const rep = String(input?.rep || "").trim();
  if (!rep) return "No rep name given.";
  const add = (arr: string[], items: any) => {
    for (const it of Array.isArray(items) ? items : []) {
      const s = String(it).trim();
      if (s && !arr.includes(s)) arr.push(s);
    }
  };
  // Compare-and-swap so a concurrent CRM edit isn't clobbered (guardedMutate may
  // re-run this on a version conflict, against freshly-read data).
  await guardedMutate<Record<string, any>>(supabase, orgId, "repProfiles", (current) => {
    const profiles: Record<string, any> = current && typeof current === "object" ? current : {};
    const p = profiles[rep] || {};
    p.strengths = Array.isArray(p.strengths) ? p.strengths : [];
    p.weaknesses = Array.isArray(p.weaknesses) ? p.weaknesses : [];
    p.patterns = Array.isArray(p.patterns) ? p.patterns : [];
    p.notes = Array.isArray(p.notes) ? p.notes : [];
    p.drills = Array.isArray(p.drills) ? p.drills : [];
    add(p.strengths, input.strengths);
    add(p.weaknesses, input.weaknesses);
    add(p.patterns, input.patterns);
    if (input.note && String(input.note).trim()) p.notes.push(String(input.note).trim());
    if (input.drill && String(input.drill).trim()) {
      const d = String(input.drill).trim();
      if (!p.drills.includes(d)) p.drills.push(d);
    }
    if (input.personality && String(input.personality).trim()) p.personality = String(input.personality).trim();
    if (input.motivation && String(input.motivation).trim()) p.motivation = String(input.motivation).trim();
    p.updatedAt = new Date().toISOString();
    profiles[rep] = p;
    return profiles;
  });
  return `Saved to ${rep}'s coaching profile.`;
}

// EILA's CUSTOMER memory — what she learns about each customer over time (wants,
// objections, situation), so she and the rep never restart a conversation cold.
// Part of her learning loop; scoped to the caller's store.
export async function saveCustomerObservation(input: any, orgId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const who = String(input?.customer || "").trim();
  if (!who) return "No customer given.";
  const key = who.toLowerCase();
  const add = (arr: string[], items: any) => {
    for (const it of Array.isArray(items) ? items : []) {
      const s = String(it).trim();
      if (s && !arr.includes(s)) arr.push(s);
    }
  };
  await guardedMutate<Record<string, any>>(supabase, orgId, "customerMemory", (current) => {
    const memo: Record<string, any> = current && typeof current === "object" ? current : {};
    const c = memo[key] || { name: who };
    c.wants = Array.isArray(c.wants) ? c.wants : [];
    c.objections = Array.isArray(c.objections) ? c.objections : [];
    c.context = Array.isArray(c.context) ? c.context : [];
    c.notes = Array.isArray(c.notes) ? c.notes : [];
    add(c.wants, input.wants);
    add(c.objections, input.objections);
    add(c.context, input.context);
    if (input.note && String(input.note).trim()) c.notes.push(String(input.note).trim());
    c.name = who;
    c.updatedAt = new Date().toISOString();
    memo[key] = c;
    return memo;
  });
  return `Saved to ${who}'s customer memory.`;
}

// EILA's STORE memory — the high-order patterns she learns about THIS floor (what
// converts, what objection-beating word tracks land, timing/source trends). The
// compounding playbook; capped to the most recent so context stays bounded.
export async function savePatternObservation(input: any, orgId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const text = String(input?.pattern || "").trim();
  if (!text) return "No pattern given.";
  await guardedMutate<any>(supabase, orgId, "storeMemory", (current) => {
    const store: any = current && typeof current === "object" ? current : {};
    store.patterns = Array.isArray(store.patterns) ? store.patterns : [];
    if (!store.patterns.some((p: any) => (typeof p === "string" ? p : p.text) === text)) {
      store.patterns.push({ text, at: new Date().toISOString() });
    }
    if (store.patterns.length > 80) store.patterns = store.patterns.slice(-80);
    store.updatedAt = new Date().toISOString();
    return store;
  });
  return "Saved to the store playbook.";
}

// EILA's MISTAKE memory — every mistake on a deal becomes a permanent lesson with
// the warning sign to watch for, so she catches it before it ever repeats. A
// mistake should only cost this store once.
export async function saveMistakeObservation(input: any, orgId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const what = String(input?.mistake || "").trim();
  if (!what) return "No mistake described.";
  await guardedMutate<any>(supabase, orgId, "mistakeMemory", (current) => {
    const store: any = current && typeof current === "object" ? current : {};
    store.mistakes = Array.isArray(store.mistakes) ? store.mistakes : [];
    const entry = {
      what,
      sign: String(input?.sign || "").trim(),
      fix: String(input?.fix || "").trim(),
      deal: String(input?.deal || "").trim(),
      at: new Date().toISOString(),
    };
    if (!store.mistakes.some((m: any) => m.what === entry.what)) store.mistakes.push(entry);
    if (store.mistakes.length > 80) store.mistakes = store.mistakes.slice(-80);
    store.updatedAt = new Date().toISOString();
    return store;
  });
  return "Logged the mistake — I'll catch it before it repeats.";
}

