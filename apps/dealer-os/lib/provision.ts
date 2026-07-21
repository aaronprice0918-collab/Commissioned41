// Owner-provisioned onboarding: create a new dealership (org), its first admin
// login, and seed starter data — all scoped to the new org. Used by the
// owner-only provisioning route and verified by a staging test.

type ProvisionInput = {
  orgName?: string;
  adminEmail?: string;
  adminPassword?: string;
  adminName?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function provisionOrg(supabase: any, input: ProvisionInput) {
  const orgName = String(input.orgName || "").trim();
  const adminEmail = String(input.adminEmail || "").trim().toLowerCase();
  const adminPassword = String(input.adminPassword || "");
  const adminName = String(input.adminName || "").trim() || adminEmail.split("@")[0];

  if (!orgName) throw new Error("Dealership name is required.");
  if (!EMAIL_RE.test(adminEmail)) throw new Error("A valid admin email is required.");
  if (adminPassword.length < 12) throw new Error("Admin password must be at least 12 characters.");

  // 1) The dealership (tenant).
  const { data: org, error: orgErr } = await supabase
    .from("organizations").insert({ name: orgName }).select("id,name").single();
  if (orgErr || !org) throw new Error(`Could not create dealership: ${orgErr?.message || "unknown"}`);

  // 2) The first admin login.
  const { data: created, error: userErr } = await supabase.auth.admin.createUser({
    email: adminEmail, password: adminPassword, email_confirm: true,
  });
  if (userErr || !created?.user) {
    await supabase.from("organizations").delete().eq("id", org.id); // avoid an orphan org
    // Non-enumerating: don't confirm whether the email already has an account.
    if (userErr) console.error("[provision] createUser failed:", userErr.message);
    throw new Error("We couldn't finish setting up this store. Please contact support to complete sign-up.");
  }

  // 3) Their profile — a store-level Admin of THEIR org only (not the platform owner).
  const { error: profErr } = await supabase.from("user_profiles").insert({
    id: created.user.id, email: adminEmail, display_name: adminName,
    employee_name: adminName, role: "Admin", org_id: org.id,
  });
  if (profErr) throw new Error(`Login created, but profile setup failed: ${profErr.message}`);

  // 4) Seed defaults so the new store's screens render immediately.
  await supabase.from("app_store").upsert([
    { org_id: org.id, key: "team", value: { salespeople: [], managers: [], financeManagers: [] }, updated_at: new Date().toISOString() },
    { org_id: org.id, key: "goals", value: {}, updated_at: new Date().toISOString() },
    // Seed the store's own NAME so its screens don't read "Kennesaw Mazda". The
    // rest (doc fee / tax / holdback / weights / targets) merges in from defaults
    // until the new store's admin tunes them in Store Settings.
    { org_id: org.id, key: "storeSettings", value: { storeName: orgName }, updated_at: new Date().toISOString() },
  ], { onConflict: "org_id,key" });

  return { orgId: org.id, orgName: org.name, adminEmail };
}
