import test from "node:test";
import assert from "node:assert/strict";
import { canWrite, isAdmin, type StoreProfile } from "./access.ts";

// Build a profile for a given role. employeeName/email are irrelevant to the
// write matrix except that an owner email always implies admin.
function profile(role: string, email = "user@dealer.com"): StoreProfile {
  return { email, role, employeeName: "Someone", orgId: "org-1" };
}

const admin = profile("Admin");
const manager = profile("Manager");
const fi = profile("F&I");
const sales = profile("Sales");
const bdc = profile("BDC");

// Every key the route enumerates, so we can assert the FULL matrix and catch any
// key that silently changes behavior.
const ALL_KEYS = [
  "payplans", "team", "storeSettings", "monthlySetup", "goals", "deals",
  "deals_backup", "closedMonths", "missionCore", "hqPipeline", "messages",
  "conversations", "crmLeads", "photos", "serviceLane", "partsCounter",
];

// ── Admin: writes everything ─────────────────────────────────────────────────
test("admin can write every privileged key", () => {
  for (const key of [
    "payplans", "team", "storeSettings", "goals", "deals", "deals_backup",
    "missionCore", "hqPipeline",
  ]) {
    assert.equal(canWrite(key, admin), true, `admin should write ${key}`);
  }
});

test("owner email is treated as admin regardless of role label", () => {
  const owner = profile("Sales", "aaronprice0918@gmail.com");
  assert.equal(isAdmin(owner), true);
  assert.equal(canWrite("payplans", owner), true);
  assert.equal(canWrite("deals_backup", owner), true);
  assert.equal(canWrite("missionCore", owner), true);
});

// ── Manager: goals + deals, but NOT store config / payplans / team / core ─────
test("manager can write goals and deals", () => {
  assert.equal(canWrite("goals", manager), true);
  assert.equal(canWrite("deals", manager), true);
});

test("manager CANNOT write payplans, team, storeSettings, missionCore, hqPipeline, deals_backup", () => {
  for (const key of ["payplans", "team", "storeSettings", "monthlySetup", "missionCore", "hqPipeline", "deals_backup"]) {
    assert.equal(canWrite(key, manager), false, `manager must NOT write ${key}`);
  }
});

// ── F&I: deals, but not goals / payplans ─────────────────────────────────────
test("F&I can write deals", () => {
  assert.equal(canWrite("deals", fi), true);
});

test("F&I CANNOT write goals or payplans", () => {
  assert.equal(canWrite("goals", fi), false);
  assert.equal(canWrite("payplans", fi), false);
  assert.equal(canWrite("storeSettings", fi), false);
  assert.equal(canWrite("deals_backup", fi), false);
});

// ── Sales / BDC: collaboration keys only, never deals/goals/payplans ─────────
test("Sales and BDC can write messages, conversations, crmLeads, photos", () => {
  for (const role of [sales, bdc]) {
    for (const key of ["messages", "conversations", "crmLeads", "photos"]) {
      assert.equal(canWrite(key, role), true, `${role.role} should write ${key}`);
    }
  }
});

test("Sales and BDC CANNOT write deals, goals, or payplans", () => {
  for (const role of [sales, bdc]) {
    for (const key of ["deals", "goals", "payplans", "team", "storeSettings", "deals_backup", "missionCore", "hqPipeline"]) {
      assert.equal(canWrite(key, role), false, `${role.role} must NOT write ${key}`);
    }
  }
});

// ── closedMonths: whoever can close the month in the UI can write the archive ─
test("closedMonths is writable by admin and manager only", () => {
  assert.equal(canWrite("closedMonths", admin), true);
  assert.equal(canWrite("closedMonths", manager), true);
  for (const role of [fi, sales, bdc]) {
    assert.equal(canWrite("closedMonths", role), false, `${role.role} must NOT write closedMonths`);
  }
});

// ── deals_backup is admin-only ───────────────────────────────────────────────
test("deals_backup is admin-only (snapshot from the owner-gated import)", () => {
  assert.equal(canWrite("deals_backup", admin), true);
  for (const role of [manager, fi, sales, bdc]) {
    assert.equal(canWrite("deals_backup", role), false, `${role.role} must NOT write deals_backup`);
  }
});

// ── Unknown key is denied for everyone (default-deny) ────────────────────────
test("an unknown/unenumerated key is denied for every authenticated role", () => {
  for (const role of [admin, manager, fi, sales, bdc]) {
    assert.equal(canWrite("totally_unknown_key", role), false, `${role.role} must be denied on unknown key`);
    assert.equal(canWrite("", role), false);
    assert.equal(canWrite("__proto__", role), false);
  }
});

// ── Dev/file-store path: no profile → permissive (documented behavior) ───────
test("no profile (local dev / no Supabase) is permissive on every key", () => {
  for (const key of [...ALL_KEYS, "anything"]) {
    assert.equal(canWrite(key, undefined), true, `dev path should allow ${key}`);
  }
});

// ── Lock the full matrix so any future change is intentional ─────────────────
test("full allow/deny matrix snapshot", () => {
  const allowed: Record<string, string[]> = {
    Admin: ["payplans", "team", "storeSettings", "monthlySetup", "goals", "deals", "deals_backup", "closedMonths", "missionCore", "hqPipeline", "messages", "conversations", "crmLeads", "photos", "serviceLane", "partsCounter"],
    Manager: ["goals", "deals", "closedMonths", "messages", "conversations", "crmLeads", "photos", "serviceLane", "partsCounter"],
    "F&I": ["deals", "messages", "conversations", "crmLeads", "photos", "serviceLane", "partsCounter"],
    Sales: ["messages", "conversations", "crmLeads", "photos"],
    BDC: ["messages", "conversations", "crmLeads", "photos"],
  };
  for (const [role, keys] of Object.entries(allowed)) {
    const p = profile(role);
    for (const key of ALL_KEYS) {
      assert.equal(canWrite(key, p), keys.includes(key), `${role} × ${key} should be ${keys.includes(key)}`);
    }
  }
});
