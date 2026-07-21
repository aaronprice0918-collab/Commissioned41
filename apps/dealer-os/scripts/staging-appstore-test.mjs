// Proves the REAL app_store table is org-isolated after migration 0004 (STAGING).
// Creates two dealerships + two manager users, seeds each org's "deals", then
// verifies each user sees only their own org — via RLS (direct access) and via
// the server's org-scoped query pattern. Run: node scripts/staging-appstore-test.mjs
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
const eA = `store.a.${stamp}@example.com`, eB = `store.b.${stamp}@example.com`;

const { data: oA } = await admin.from("organizations").insert({ name: "Dealer A" }).select().single();
const { data: oB } = await admin.from("organizations").insert({ name: "Dealer B" }).select().single();
const { data: uA } = await admin.auth.admin.createUser({ email: eA, password: pw, email_confirm: true });
const { data: uB } = await admin.auth.admin.createUser({ email: eB, password: pw, email_confirm: true });
await admin.from("user_profiles").insert([
  { id: uA.user.id, email: eA, role: "Manager", org_id: oA.id },
  { id: uB.user.id, email: eB, role: "Manager", org_id: oB.id },
]);
await admin.from("app_store").insert([
  { org_id: oA.id, key: "deals", value: [{ customer: "A-customer", gross: 5000 }] },
  { org_id: oB.id, key: "deals", value: [{ customer: "B-customer", gross: 9000 }] },
]);
console.log(`Seeded Dealer A (${oA.id.slice(0, 8)}) and Dealer B (${oB.id.slice(0, 8)}).\n`);

// Direct access as Dealer A's user (RLS-enforced).
const ca = createClient(URL_, PUB, { auth: { persistSession: false } });
await ca.auth.signInWithPassword({ email: eA, password: pw });
const aAll = await ca.from("app_store").select("org_id,key,value");
check("Dealer A's user sees only their own org rows", !aAll.error && (aAll.data || []).length >= 1 && (aAll.data || []).every((r) => r.org_id === oA.id));
check("Dealer A's user sees NONE of Dealer B's rows", !(aAll.data || []).some((r) => r.org_id === oB.id));
const aReadB = await ca.from("app_store").select("*").eq("org_id", oB.id);
check("Dealer A querying Dealer B directly returns nothing", !aReadB.error && (aReadB.data || []).length === 0);
const aWriteB = await ca.from("app_store").insert({ org_id: oB.id, key: "evil", value: [1] });
check("Dealer A is BLOCKED from writing into Dealer B", !!aWriteB.error);

// The server's org-scoped query pattern (service role + explicit org filter).
const aDeals = await admin.from("app_store").select("value").eq("org_id", oA.id).eq("key", "deals").maybeSingle();
const bDeals = await admin.from("app_store").select("value").eq("org_id", oB.id).eq("key", "deals").maybeSingle();
check("Server-scoped read for Dealer A returns only A's deals", aDeals.data?.value?.[0]?.customer === "A-customer");
check("Server-scoped read for Dealer B returns only B's deals", bDeals.data?.value?.[0]?.customer === "B-customer");

console.log(pass ? "\n✅ ALL CHECKS PASSED — app_store is org-isolated (Dealer A cannot see Dealer B)." : "\n❌ SOME CHECKS FAILED.");
process.exit(pass ? 0 : 1);
