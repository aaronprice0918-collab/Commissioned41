// One-time (idempotent) Stripe setup: creates the "MissionOS" product and a
// $499/month recurring price in whatever mode the secret key belongs to (test/live).
// Safe to re-run — it reuses an existing product/price instead of duplicating.
//
// Run from the repo root:  node scripts/stripe-setup.mjs
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";

// --- Load STRIPE_SECRET_KEY straight from .env.local (no dotenv dependency) ---
function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnvLocal();
const key = env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("❌ STRIPE_SECRET_KEY not found in .env.local");
  process.exit(1);
}
const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST";
const stripe = new Stripe(key);

const PRODUCT_NAME = "MissionOS";
const PRODUCT_DESC = "MissionOS — the dealership operating system by Commissioned 41.";
const LOOKUP_KEY = "missionos_monthly_499"; // stable handle so we never duplicate the price
const AMOUNT_CENTS = 49900; // $499.00
const CURRENCY = "usd";

async function findProduct() {
  const list = await stripe.products.list({ active: true, limit: 100 });
  return list.data.find((p) => p.metadata?.app === "missionos") || null;
}

async function main() {
  console.log(`\n🔌 Connecting to Stripe in ${mode} mode...`);

  // 1) Product — reuse if we already made it
  let product = await findProduct();
  if (product) {
    console.log(`✅ Product already exists: ${product.name} (${product.id})`);
  } else {
    product = await stripe.products.create({
      name: PRODUCT_NAME,
      description: PRODUCT_DESC,
      metadata: { app: "missionos" },
    });
    console.log(`✨ Created product: ${product.name} (${product.id})`);
  }

  // 2) Price — look up by stable lookup_key, reuse if present
  const existing = await stripe.prices.list({
    lookup_keys: [LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  let price = existing.data[0] || null;
  if (price) {
    console.log(`✅ Price already exists: $${(price.unit_amount / 100).toFixed(2)}/${price.recurring?.interval} (${price.id})`);
  } else {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: AMOUNT_CENTS,
      currency: CURRENCY,
      recurring: { interval: "month" },
      lookup_key: LOOKUP_KEY,
      metadata: { app: "missionos" },
    });
    console.log(`✨ Created price: $${(AMOUNT_CENTS / 100).toFixed(2)}/month (${price.id})`);
  }

  console.log("\n─────────────────────────────────────────────");
  console.log("  Add this line to .env.local (the price ID is not secret):");
  console.log(`  STRIPE_PRICE_ID=${price.id}`);
  console.log("─────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("❌ Stripe setup failed:", err.message);
  process.exit(1);
});
