import fs from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

// Seed the app_store with the demo dataset in data/*.json.
//
// Multi-tenant (every row is scoped to an org). Set the target org with
// SEED_ORG_ID (defaults to the canonical first org). Optionally set
// SEED_EXPECT_HOST to a substring of the Supabase host as a safety guard so the
// seed refuses to run against an unexpected database (e.g. production).
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   SEED_ORG_ID=<org uuid> SEED_EXPECT_HOST=whboyuuvmqcfytqtvoap \
//   npm run seed:supabase

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

// The canonical first org (matches DEFAULT_ORG_ID in lib/orgs.ts).
const ORG_ID = process.env.SEED_ORG_ID || "00000000-0000-0000-0000-000000000001";

// Safety: refuse to seed a database whose host doesn't match the expectation.
const expectHost = process.env.SEED_EXPECT_HOST;
if (expectHost && !url.includes(expectHost)) {
  console.error(`Refusing to seed: target host (${url}) does not contain "${expectHost}".`);
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`Seeding org ${ORG_ID} at ${url}`);

const keys = ["deals", "team", "payplans", "messages", "goals", "photos", "crmLeads"];

for (const key of keys) {
  let value = null;
  try {
    value = JSON.parse(await fs.readFile(`data/${key}.json`, "utf8"));
  } catch {
    value = key === "photos" ? {} : [];
  }

  const { error } = await supabase.from("app_store").upsert(
    {
      org_id: ORG_ID,
      key,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,key" },
  );

  if (error) {
    console.error(`Failed to seed ${key}:`, error.message);
    process.exit(1);
  }

  console.log(`Seeded ${key} (${Array.isArray(value) ? value.length + " items" : "object"}).`);
}

console.log("Done.");
