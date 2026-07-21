// Multi-tenant isolation test (STAGING only).
// Reads keys from .env.staging.local (gitignored). Creates two dealerships +
// two users, seeds each org's data, then proves — through Row-Level Security —
// that each user sees ONLY their own org's data and cannot touch the other's.
//   run:  node scripts/staging-tenant-test.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.staging.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const URL_ = env.STAGING_SUPABASE_URL, PUB = env.STAGING_SUPABASE_PUBLISHABLE_KEY, SECRET = env.STAGING_SUPABASE_SECRET_KEY;

const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });
let pass = true;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); if (!ok) pass = false; };

const stamp = Date.now(), pw = "Test-12345!";
const emailA = `owner.a.${stamp}@example.com`, emailB = `owner.b.${stamp}@example.com`;

// 1) Seed two orgs + users + data using the secret key (bypasses RLS).
const { data: orgA } = await admin.from("organizations").insert({ name: "Store A" }).select().single();
const { data: orgB } = await admin.from("organizations").insert({ name: "Store B" }).select().single();
const { data: uA } = await admin.auth.admin.createUser({ email: emailA, password: pw, email_confirm: true });
const { data: uB } = await admin.auth.admin.createUser({ email: emailB, password: pw, email_confirm: true });
await admin.from("org_members").insert([
  { user_id: uA.user.id, org_id: orgA.id, role: "owner" },
  { user_id: uB.user.id, org_id: orgB.id, role: "owner" },
]);
await admin.from("tenant_store").insert([
  { org_id: orgA.id, key: "secret", value: { note: "A-only confidential" } },
  { org_id: orgB.id, key: "secret", value: { note: "B-only confidential" } },
]);
console.log(`Seeded Store A (${orgA.id.slice(0, 8)}) and Store B (${orgB.id.slice(0, 8)}).\n`);

// 2) Sign in as User A and probe.
const ca = createClient(URL_, PUB, { auth: { persistSession: false } });
await ca.auth.signInWithPassword({ email: emailA, password: pw });
const aRows = await ca.from("tenant_store").select("org_id,key,value");
check("User A sees exactly 1 row (their own)", !aRows.error && aRows.data?.length === 1);
check("User A's row belongs to Store A", aRows.data?.[0]?.org_id === orgA.id);
check("User A sees NONE of Store B's data", !(aRows.data || []).some((r) => r.org_id === orgB.id));
const aReadB = await ca.from("tenant_store").select("*").eq("org_id", orgB.id);
check("User A querying Store B directly returns nothing", !aReadB.error && (aReadB.data || []).length === 0);
const aWriteB = await ca.from("tenant_store").insert({ org_id: orgB.id, key: "evil", value: { x: 1 } });
check("User A is BLOCKED from writing into Store B", !!aWriteB.error);

// 3) Sign in as User B and confirm the mirror.
const cb = createClient(URL_, PUB, { auth: { persistSession: false } });
await cb.auth.signInWithPassword({ email: emailB, password: pw });
const bRows = await cb.from("tenant_store").select("org_id,key,value");
check("User B sees exactly 1 row (their own)", !bRows.error && bRows.data?.length === 1);
check("User B's row belongs to Store B", bRows.data?.[0]?.org_id === orgB.id);

// 4) Anonymous (no login) sees nothing.
const anon = createClient(URL_, PUB, { auth: { persistSession: false } });
const anonRows = await anon.from("tenant_store").select("*");
check("Anonymous visitor sees NO tenant data", (anonRows.data || []).length === 0);

console.log(pass ? "\n✅ ALL CHECKS PASSED — tenant isolation holds (Store A cannot see Store B)." : "\n❌ SOME CHECKS FAILED — isolation is NOT airtight.");
process.exit(pass ? 0 : 1);
