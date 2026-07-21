import { describe, expect, it } from "vitest";
import { changedFields, mergeListBy, mergeUserEdits } from "./mergeEdits";

describe("changedFields", () => {
  it("returns only the keys the draft changed vs baseline", () => {
    const base = { a: 1, b: 2, c: 3 };
    const draft = { a: 1, b: 20, c: 3 };
    expect(changedFields(base, draft)).toEqual({ b: 20 });
  });

  it("captures a key the user cleared to undefined", () => {
    const base = { takeHomeGoal: 6000, goalUnits: 12 };
    const draft = { takeHomeGoal: undefined as number | undefined, goalUnits: 12 };
    expect(changedFields(base, draft)).toEqual({ takeHomeGoal: undefined });
  });

  it("captures a key the user added", () => {
    const base: Record<string, number> = { a: 1 };
    const draft: Record<string, number> = { a: 1, b: 5 };
    expect(changedFields(base, draft)).toEqual({ b: 5 });
  });

  it("is empty when nothing changed", () => {
    const base = { a: 1, b: 2 };
    expect(changedFields(base, { ...base })).toEqual({});
  });
});

describe("mergeUserEdits — the anti-clobber guarantee", () => {
  it("preserves a concurrent writer's change to a field the user didn't touch", () => {
    // Editor opened with goal $6k. User edited ONLY the tax rate. Meanwhile EILA
    // set the goal to $20k in the live store. Saving must keep the $20k.
    const baseline = { takeHomeGoal: 6000, taxRate: 20, goalUnits: 12 };
    const draft = { takeHomeGoal: 6000, taxRate: 24, goalUnits: 12 }; // user changed tax only
    const live = { takeHomeGoal: 20000, taxRate: 20, goalUnits: 12 }; // EILA changed goal
    expect(mergeUserEdits(live, baseline, draft)).toEqual({
      takeHomeGoal: 20000, // EILA's change survives
      taxRate: 24, // user's change applies
      goalUnits: 12,
    });
  });

  it("the user's own edit to a field still wins over live", () => {
    const baseline = { takeHomeGoal: 6000 };
    const draft = { takeHomeGoal: 25000 }; // user explicitly set it
    const live = { takeHomeGoal: 20000 };
    expect(mergeUserEdits(live, baseline, draft)).toEqual({ takeHomeGoal: 25000 });
  });

  it("keeps live-only fields the draft never knew about", () => {
    const baseline = { a: 1 };
    const draft = { a: 2 };
    const live = { a: 1, money: { balance: 500 } } as Record<string, unknown>;
    expect(mergeUserEdits(live, baseline as Record<string, unknown>, draft as Record<string, unknown>)).toEqual({
      a: 2,
      money: { balance: 500 },
    });
  });
});

describe("mergeListBy — row-level anti-clobber for sheet-edited lists", () => {
  type Bill = { id: string; name: string; amount: number };
  const rent = { id: "r", name: "Rent", amount: 1500 };
  const netflix = { id: "n", name: "Netflix", amount: 16 };
  const gym = { id: "g", name: "Gym", amount: 40 };
  const seeded: Bill[] = [rent, netflix, gym];
  const key = (b: Bill) => b.id;

  it("the verifier's exact scenario: user edits Rent while EILA bumps Netflix and removes Gym — all three intents survive", () => {
    const draft = [{ ...rent, amount: 1600 }, netflix, gym]; // user touched only Rent
    const latest = [rent, { ...netflix, amount: 26 }]; // EILA: Netflix → $26, Gym removed
    expect(mergeListBy(key, seeded, draft, latest)).toEqual([
      { id: "r", name: "Rent", amount: 1600 }, // user's edit wins
      { id: "n", name: "Netflix", amount: 26 }, // EILA's edit survives
      // Gym stays deleted — no resurrection
    ]);
  });

  it("a row added elsewhere mid-edit is kept; a row the user added is kept", () => {
    const insurance = { id: "i", name: "Insurance", amount: 120 };
    const userNew = { id: "u", name: "Streaming", amount: 12 };
    const draft = [...seeded, userNew];
    const latest = [...seeded, insurance];
    const out = mergeListBy(key, seeded, draft, latest);
    expect(out).toContainEqual(userNew);
    expect(out).toContainEqual(insurance);
    expect(out).toHaveLength(5);
  });

  it("a row the user deleted stays deleted even if untouched elsewhere", () => {
    const draft = [rent, netflix]; // user deleted Gym
    expect(mergeListBy(key, seeded, draft, seeded)).toEqual([rent, netflix]);
  });

  it("user editing the SAME row a concurrent writer edited — the user (looking at it) wins", () => {
    const draft = [{ ...rent, amount: 1600 }, netflix, gym];
    const latest = [{ ...rent, amount: 1900 }, netflix, gym];
    expect(mergeListBy(key, seeded, draft, latest)[0].amount).toBe(1600);
  });

  it("untouched draft: latest wins wholesale (pure pass-through)", () => {
    const latest = [{ ...rent, amount: 1750 }, gym]; // edited + removed elsewhere
    expect(mergeListBy(key, seeded, [...seeded], latest)).toEqual(latest);
  });

  it("goals scenario: EILA adds $500 to Vacation while the user edits Truck — both land", () => {
    type Goal = { id: string; name: string; target: number; saved: number };
    const truck = { id: "t", name: "Truck", target: 20000, saved: 3000 };
    const vac = { id: "v", name: "Vacation", target: 5000, saved: 1000 };
    const gSeed: Goal[] = [truck, vac];
    const draft = [{ ...truck, target: 25000 }, vac];
    const latest = [truck, { ...vac, saved: 1500 }];
    expect(mergeListBy((g: Goal) => g.id, gSeed, draft, latest)).toEqual([
      { ...truck, target: 25000 },
      { ...vac, saved: 1500 },
    ]);
  });
});
