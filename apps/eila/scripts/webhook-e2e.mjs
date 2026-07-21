// End-to-end proof for the Stripe webhook -> entitlements table -> access flip.
// Runs against the LOCAL server (npm run start) using Stripe TEST mode. No live
// money, no live keys. Cleans up everything it creates.
//
// Proves:
//  1. A signed "subscription active" webhook writes an entitled row.
//  2. /api/entitlement then returns active for that user — and since Stripe has
//     NO real subscription for the test customer, an "active" answer can ONLY
//     have come from our table (proves the fast-path actually drives access).
//  3. A signed "subscription canceled" webhook flips the row -> access removed.
//  4. A forged (bad-signature) webhook is rejected with 400.
import Stripe from "stripe";
import { readFileSync } from "node:fs";

// --- load .env.local ---
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const BASE = "http://localhost:3000";
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const WHSEC = env.STRIPE_WEBHOOK_SECRET;
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const stamp = Math.floor(Date.now() / 1000);
const email = `e2e-${stamp}@example.com`;
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); };

// Build a signed webhook request body the same way Stripe does.
function signed(type, subOverrides) {
  const sub = {
    id: `sub_e2e_${stamp}`, object: "subscription", status: "active",
    customer: customerId, items: { data: [{ current_period_end: stamp + 30 * 86400 }] },
    ...subOverrides,
  };
  const payload = JSON.stringify({ id: `evt_${stamp}`, object: "event", type, data: { object: sub } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  return { payload, header };
}
const postWebhook = (payload, header) =>
  fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": header }, body: payload });

let customerId, userId, token;

try {
  // Real TEST-mode Stripe customer (so the webhook's customer lookup resolves to our email).
  const customer = await stripe.customers.create({ email, metadata: { e2e: "true" } });
  customerId = customer.id;
  console.log(`setup: test customer ${customerId} for ${email}`);

  // Real Supabase auth user with the SAME email (so /api/entitlement maps token -> email).
  const su = await (await fetch(`${SUPA}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: `Pw-${stamp}-x!` }) })).json();
  token = su.access_token; userId = su.user?.id;
  console.log(`setup: supabase user ${userId}\n`);

  // 1) ACTIVE webhook -> row written
  let r = await postWebhook(...Object.values(signed("customer.subscription.created")));
  check("active webhook accepted (200)", r.status === 200, `HTTP ${r.status}`);
  const row1 = await (await fetch(`${SUPA}/rest/v1/lite_entitlements?email=eq.${email}&select=status,entitled`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } })).json();
  check("row written entitled=true", row1[0]?.entitled === true && row1[0]?.status === "active", JSON.stringify(row1[0] || null));

  // 2) /api/entitlement returns active — Stripe has NO sub for this customer, so this PROVES the table drove it
  let e = await (await fetch(`${BASE}/api/entitlement`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).json();
  check("entitlement=active from TABLE (not Stripe)", e.active === true, JSON.stringify(e));

  // 3) CANCELED webhook -> access removed
  r = await postWebhook(...Object.values(signed("customer.subscription.deleted", { status: "canceled" })));
  check("canceled webhook accepted (200)", r.status === 200, `HTTP ${r.status}`);
  const row2 = await (await fetch(`${SUPA}/rest/v1/lite_entitlements?email=eq.${email}&select=status,entitled`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } })).json();
  check("row flipped entitled=false", row2[0]?.entitled === false && row2[0]?.status === "canceled", JSON.stringify(row2[0] || null));
  e = await (await fetch(`${BASE}/api/entitlement`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).json();
  check("entitlement=inactive after cancel", e.active === false, JSON.stringify(e));

  // 4) Forged signature rejected
  r = await postWebhook(JSON.stringify({ id: "evt_forged", type: "customer.subscription.created", data: { object: {} } }), "t=1,v1=forged");
  check("forged webhook rejected (400)", r.status === 400, `HTTP ${r.status}`);
} catch (err) {
  fail++;
  console.error("\nERROR (aborted mid-run):", err?.stack || err);
} finally {
  // Cleanup: delete the entitlement row, the Stripe test customer, the auth user.
  await fetch(`${SUPA}/rest/v1/lite_entitlements?email=eq.${email}`, { method: "DELETE", headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }).catch(() => {});
  if (customerId) await stripe.customers.del(customerId).catch(() => {});
  if (userId) await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }).catch(() => {});
  console.log(`\ncleanup: removed test row, customer, user`);
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}
