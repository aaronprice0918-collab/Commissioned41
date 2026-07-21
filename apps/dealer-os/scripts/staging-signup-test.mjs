// Proves the self-serve sign-up flow produces a correctly-isolated dealership
// (STAGING). Mirrors lib/provision.ts: create org + admin + profile + seed, then
// confirm the new admin sees only their own store and not org #1's data.
// Run: node scripts/staging-signup-test.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.staging.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const URL_ = env.STAGING_SUPABASE_URL, PUB = env.STAGING_SUPABASE_PUBLISHABLE_KEY, SECRET = env.STAGING_SUPABASE_SECRET_KEY;
const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });
const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";
let pass = true;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); if (!ok) pass = false; };

const stamp = Date.now(), pw = "Test-12345!";
const email = `owner.${stamp}@testmotors.com`;

// Put a private row in org #1 (Kennesaw) so we can confirm the new dealer can't see it.
await admin.from("app_store").upsert(
  { org_id: DEFAULT_ORG, key: "deals", value: [{ customer: "Kennesaw-private" }], updated_at: new Date().toISOString() },
  { onConflict: "org_id,key" });

// --- self-serve sign-up (mirrors lib/provision.ts provisionOrg) ---
const { data: org } = await admin.from("organizations").insert({ name: "Test Motors" }).select("id,name").single();
const { data: created } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
await admin.from("user_profiles").insert({ id: created.user.id, email, display_name: "Pat Seller", employee_name: "Pat Seller", role: "Admin", org_id: org.id });
await admin.from("app_store").upsert([
  { org_id: org.id, key: "team", value: { salespeople: [], managers: [], financeManagers: [] }, updated_at: new Date().toISOString() },
  { org_id: org.id, key: "goals", value: {}, updated_at: new Date().toISOString() },
], { onConflict: "org_id,key" });
console.log(`Signed up "Test Motors" (${org.id.slice(0, 8)}) with admin ${email}.\n`);

// --- the new admin logs in and we check what they can see ---
const c = createClient(URL_, PUB, { auth: { persistSession: false } });
const { error: signInErr } = await c.auth.signInWithPassword({ email, password: pw });
check("New dealer admin can log in", !signInErr);

const mine = await c.from("app_store").select("org_id,key");
check("New dealer sees their seeded setup (team + goals)", !mine.error && mine.data?.length === 2 && mine.data.every((r) => r.org_id === org.id));
check("New dealer sees NONE of Kennesaw's (org #1) data", !(mine.data || []).some((r) => r.org_id === DEFAULT_ORG));

const peek = await c.from("app_store").select("*").eq("org_id", DEFAULT_ORG);
check("New dealer querying Kennesaw directly returns nothing", !peek.error && (peek.data || []).length === 0);

console.log(pass ? "\n✅ ALL CHECKS PASSED — self-serve sign-up creates an isolated dealership." : "\n❌ SOME CHECKS FAILED.");
process.exit(pass ? 0 : 1);
