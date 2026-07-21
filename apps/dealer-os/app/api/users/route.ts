import { NextRequest, NextResponse } from "next/server";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Staff management is available to any store ADMIN (and the platform owner), and
// is scoped to the caller's own organization — an admin can only see and manage
// users in their own dealership, never another tenant's.
async function requireAdmin(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { supabase: null, ok: false, orgId: DEFAULT_ORG_ID, isOwner: false, userId: "" };
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { supabase, ok: false, orgId: DEFAULT_ORG_ID, isOwner: false, userId: "" };
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return { supabase, ok: false, orgId: DEFAULT_ORG_ID, isOwner: false, userId: "" };
  const owner = isOwnerEmail(data.user.email);
  const { data: profile } = await supabase
    .from("user_profiles").select("role, org_id").eq("id", data.user.id).maybeSingle();
  const role = owner ? "Admin" : normalizeAccessRole(profile?.role);
  const orgId = profile?.org_id || DEFAULT_ORG_ID;
  return { supabase, ok: owner || role === "Admin", orgId, isOwner: owner, userId: data.user.id };
}

export async function GET(request: NextRequest) {
  const { supabase, ok, orgId } = await requireAdmin(request);
  if (!supabase || !ok) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  // Only this org's profiles, joined to their auth record for the email/login.
  const [{ data: authData, error: authError }, { data: profiles, error: profileError }] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("user_profiles").select("id, email, display_name, role, employee_name, org_id").eq("org_id", orgId),
  ]);

  if (authError) {
    console.error("[users] listUsers failed:", authError.message);
    return NextResponse.json({ error: "Could not load users" }, { status: 500 });
  }
  if (profileError) {
    console.error("[users] profiles read failed:", profileError.message);
    return NextResponse.json({ error: "Could not load users" }, { status: 500 });
  }

  const authById = new Map((authData.users || []).map((u) => [u.id, u]));
  const users = (profiles || []).map((profile) => {
    const auth = authById.get(profile.id);
    const email = profile.email || auth?.email || "";
    const owner = isOwnerEmail(email);
    return {
      id: profile.id,
      email,
      displayName: profile.display_name || email.split("@")[0] || "Employee",
      employeeName: profile.employee_name || profile.display_name || email.split("@")[0] || "Employee",
      role: owner ? "Admin" : normalizeAccessRole(profile.role),
      isOwner: owner,
    };
  });

  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const { supabase, ok, orgId, userId } = await requireAdmin(request);
  if (!supabase || !ok) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  // Cap staff-account churn per admin (create/update/delete) to blunt abuse.
  const rl = await rateLimit(clientKey(request, userId), { limit: 30, windowSec: 60 });
  if (!rl.ok) return tooManyRequests(rl);

  const body = await request.json();

  // CREATE a brand-new staff login in the caller's org.
  if (body.action === "create") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const employeeName = String(body.employeeName || body.displayName || "").trim() || email.split("@")[0];
    const role = isOwnerEmail(email) ? "Admin" : normalizeAccessRole(body.role);
    if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    if (password.length < 12) return NextResponse.json({ error: "Temporary password must be at least 12 characters." }, { status: 400 });

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr || !created?.user) {
      if (createErr) console.error("[users] createUser failed:", createErr.message);
      return NextResponse.json({ error: "That email may already have a login." }, { status: 400 });
    }
    const { error: profErr } = await supabase.from("user_profiles").insert({
      id: created.user.id, email, display_name: employeeName, employee_name: employeeName, role, org_id: orgId,
    });
    if (profErr) {
      console.error("[users] profile insert failed:", profErr.message);
      return NextResponse.json({ error: "Could not finish creating the login" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, created: true, role });
  }

  // UPDATE an existing user's name/role — only if they belong to the caller's org.
  const email = String(body.email || "").trim().toLowerCase();
  const role = isOwnerEmail(email) ? "Admin" : normalizeAccessRole(body.role);
  if (!body.id || !email) return NextResponse.json({ error: "Missing user" }, { status: 400 });

  const { data: target } = await supabase.from("user_profiles").select("org_id").eq("id", body.id).maybeSingle();
  if (!target || target.org_id !== orgId) {
    return NextResponse.json({ error: "That user isn't in your store." }, { status: 403 });
  }

  const { error } = await supabase.from("user_profiles").upsert({
    id: body.id,
    email,
    display_name: body.displayName || body.employeeName || email.split("@")[0],
    employee_name: body.employeeName || body.displayName || email.split("@")[0],
    role,
    org_id: orgId,
  }, { onConflict: "id" });

  if (error) {
    console.error("[users] profile upsert failed:", error.message);
    return NextResponse.json({ error: "Could not update the user" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, role });
}

// DELETE a staff login entirely — for when someone is fired or quits. Removes
// their profile AND their auth login, scoped to the caller's org. The platform
// owner can never be removed, and an admin can't delete their own login (that
// would lock the store out). Past deals stay on record (they reference the name,
// not the login), so commission history is preserved.
export async function DELETE(request: NextRequest) {
  const { supabase, ok, orgId, userId } = await requireAdmin(request);
  if (!supabase || !ok) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Missing user" }, { status: 400 });
  if (id === userId) return NextResponse.json({ error: "You can't remove your own login." }, { status: 400 });

  const { data: target } = await supabase
    .from("user_profiles").select("org_id, email").eq("id", id).maybeSingle();
  if (!target || target.org_id !== orgId) {
    return NextResponse.json({ error: "That user isn't in your store." }, { status: 403 });
  }
  if (isOwnerEmail(target.email)) {
    return NextResponse.json({ error: "The store owner can't be removed." }, { status: 400 });
  }

  const { error: profErr } = await supabase.from("user_profiles").delete().eq("id", id);
  if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

  // Now revoke the actual login. If the auth record is already gone, that's fine —
  // removing access is exactly what we wanted.
  const { error: authErr } = await supabase.auth.admin.deleteUser(id);
  if (authErr && !/not.*found/i.test(authErr.message)) {
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: true });
}
