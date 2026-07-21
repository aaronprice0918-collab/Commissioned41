import test from "node:test";
import assert from "node:assert/strict";
import { guardedMutate } from "./storeServer.ts";

// guardedMutate is the write-safety primitive under every EILA server write
// (update_lead, update_deal, set_goals, close_month, service/parts, memory).
// This fakes the subset of the Supabase builder it uses to prove: first-write
// inserts, a normal write commits, and — the whole point — a concurrent write
// between our read and our update is NOT clobbered (the mutator re-runs on
// fresh data and both changes survive).

function makeFakeSupabase(initial: Record<string, { value: unknown; updated_at: string }> = {}) {
  const store = new Map(Object.entries(initial));
  let stamp = 100;
  let racer: ((s: Map<string, { value: unknown; updated_at: string }>) => void) | null = null;
  const api = {
    _get: (k: string) => store.get(k),
    _setRacer: (fn: typeof racer) => { racer = fn; },
    from() {
      const b: any = { _f: {}, _op: null as null | "update", _vals: null as any };
      b.eq = (col: string, val: unknown) => { b._f[col] = val; return b; };
      b.update = (vals: any) => { b._op = "update"; b._vals = vals; return b; };
      b.insert = async (vals: any) => {
        const k = `${vals.org_id}|${vals.key}`;
        if (store.has(k)) return { error: { message: "conflict" } };
        store.set(k, { value: vals.value, updated_at: vals.updated_at });
        return { error: null };
      };
      b.maybeSingle = async () => {
        const row = store.get(`${b._f.org_id}|${b._f.key}`);
        return { data: row ? { value: row.value, updated_at: row.updated_at } : null, error: null };
      };
      b.select = () => {
        if (b._op !== "update") return b; // read chain: select → eq → eq → maybeSingle
        return (async () => {
          if (racer) { racer(store); racer = null; } // simulate a writer landing between our read and update
          const k = `${b._f.org_id}|${b._f.key}`;
          const row = store.get(k);
          if (row && String(row.updated_at) === String(b._f.updated_at)) {
            store.set(k, { value: b._vals.value, updated_at: b._vals.updated_at });
            return { data: [{ updated_at: b._vals.updated_at }], error: null };
          }
          return { data: [], error: null }; // version moved — 0 rows, guardedMutate retries
        })();
      };
      void stamp;
      return b;
    },
  };
  return api;
}

test("first write (no row) inserts", async () => {
  const supa = makeFakeSupabase();
  await guardedMutate(supa as any, "org1", "goals", () => ({ teamDeliveredUnits: 130 }));
  assert.deepEqual(supa._get("org1|goals")?.value, { teamDeliveredUnits: 130 });
});

test("a normal write commits the mutation", async () => {
  const supa = makeFakeSupabase({ "org1|goals": { value: { a: 1 }, updated_at: "t0" } });
  await guardedMutate<Record<string, number>>(supa as any, "org1", "goals", (cur) => ({ ...(cur || {}), b: 2 }));
  assert.deepEqual(supa._get("org1|goals")?.value, { a: 1, b: 2 });
});

test("a concurrent write is NOT clobbered — mutator re-runs on fresh data, both survive", async () => {
  const supa = makeFakeSupabase({ "org1|leads": { value: { a: 1 }, updated_at: "t0" } });
  // A racer lands {a:1,b:2}@t99 between our first read and our first update.
  supa._setRacer((s) => s.set("org1|leads", { value: { a: 1, b: 2 }, updated_at: "t99" }));
  await guardedMutate<Record<string, number>>(supa as any, "org1", "leads", (cur) => ({ ...(cur || {}), c: 3 }));
  // First CAS fails (version moved t0→t99); retry reads {a:1,b:2}, applies c:3.
  assert.deepEqual(supa._get("org1|leads")?.value, { a: 1, b: 2, c: 3 });
});
