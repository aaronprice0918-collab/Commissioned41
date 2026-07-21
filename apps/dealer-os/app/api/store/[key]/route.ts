import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { canWrite, isAdmin, normalizeAccessRole, type StoreProfile } from "@/lib/access";
import { orgEntitled } from "@/lib/billing";
import { samePerson as matchesPerson } from "@/lib/data";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { sanitizeStoreValue } from "@/lib/moneyGuard";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { logSecurityEvent } from "@/lib/securityLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedKeys = new Set(["deals", "deals_backup", "closedMonths", "team", "payplans", "messages", "conversations", "photos", "goals", "crmLeads", "missionCore", "hqPipeline", "storeSettings", "monthlySetup", "serviceLane", "partsCounter"]);
const dataDir = path.join(process.cwd(), "data");
// The local JSON file store performs NO authentication. It is a development
// convenience only and must never serve as an unauthenticated backend in
// production. Production deployments are required to configure Supabase.
const fileStoreAllowed = process.env.NODE_ENV !== "production";

function fileFor(key: string) {
  if (!allowedKeys.has(key)) {
    throw new Error("Invalid store key");
  }

  return path.join(dataDir, `${key}.json`);
}

async function requireUser(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { supabase: null, ok: fileStoreAllowed };

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { supabase, ok: false };

  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return { supabase, ok: false };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("email, display_name, role, employee_name, org_id")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    supabase,
    ok: true,
    profile: normalizeProfile(profile, data.user.email || ""),
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    if (!allowedKeys.has(key)) {
      return NextResponse.json({ error: "Invalid store key" }, { status: 404 });
    }

    const { supabase, ok, profile } = await requireUser(request);
    if (supabase) {
      if (!ok) {
        logSecurityEvent("auth_failed", { route: `store/${key}`, reason: "get" });
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const orgId = profile?.orgId;
      if (!orgId) return NextResponse.json({ error: "No organization for this account" }, { status: 403 });
      // Billing gate — a lapsed store reads nothing. Free for the founding
      // store and while Stripe isn't configured (lib/billing.ts fail-open).
      const gate = await orgEntitled(supabase, orgId);
      if (!gate.entitled) {
        logSecurityEvent("entitlement_denied", { route: `store/${key}`, orgId, reason: gate.reason });
        return NextResponse.json({ error: "subscription_required", reason: gate.reason }, { status: 402 });
      }
      const { data, error } = await supabase
        .from("app_store").select("value, updated_at").eq("org_id", orgId).eq("key", key).maybeSingle();
      if (error) {
        console.error(`[store/${key}] read failed:`, error.message);
        return NextResponse.json({ error: "Could not load data" }, { status: 500 });
      }
      // The row's write-stamp rides back as an opaque version so the client can
      // do compare-and-swap writes (see POST) — a stale device's whole-array
      // save gets rejected instead of silently overwriting everyone's work.
      return NextResponse.json(await filterForUser(supabase, orgId, key, data?.value ?? null, profile), {
        headers: data?.updated_at ? { "x-store-version": String(data.updated_at) } : undefined,
      });
    }

    if (!ok) {
      return NextResponse.json({ error: "Secure store is not connected" }, { status: 503 });
    }

    const file = fileFor(key);
    const text = await fs.readFile(file, "utf8");
    // Dev file store versions by file mtime so the CAS flow is testable locally.
    const stat = await fs.stat(file);
    return NextResponse.json(JSON.parse(text), { headers: { "x-store-version": String(stat.mtimeMs) } });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid store key") {
      return NextResponse.json({ error: "Invalid store key" }, { status: 404 });
    }

    return NextResponse.json(null);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    if (!allowedKeys.has(key)) {
      return NextResponse.json({ error: "Invalid store key" }, { status: 404 });
    }

    const body = await request.json();
    const { supabase, ok, profile } = await requireUser(request);
    if (supabase) {
      if (!ok) {
        logSecurityEvent("auth_failed", { route: `store/${key}`, reason: "post" });
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!canWrite(key, profile)) {
        logSecurityEvent("role_denied", { route: `store/${key}`, userId: profile?.email });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const orgId = profile?.orgId;
      if (!orgId) return NextResponse.json({ error: "No organization for this account" }, { status: 403 });
      // Rate-limit writes per user so a bug or a compromised session can't flood
      // the store (generous ceiling — normal use is nowhere near this).
      const rl = await rateLimit(clientKey(request, profile?.email), { limit: 120, windowSec: 60 });
      if (!rl.ok) {
        logSecurityEvent("rate_limited", { route: `store/${key}`, orgId, userId: profile?.email });
        return tooManyRequests(rl);
      }
      const writeGate = await orgEntitled(supabase, orgId);
      if (!writeGate.entitled) {
        logSecurityEvent("entitlement_denied", { route: `store/${key}`, orgId, reason: writeGate.reason });
        return NextResponse.json({ error: "subscription_required", reason: writeGate.reason }, { status: 402 });
      }
      // Coerce money fields to finite, sane numbers before persisting — no NaN /
      // "1e9" / Infinity can reach the pay engine (SOC 2 PI1.x). Non-money data
      // is untouched.
      const nextValue = sanitizeStoreValue(
        key,
        key === "messages"
          ? await mergeMessages(supabase, orgId, body, profile)
          : key === "conversations"
            ? await mergeConversations(supabase, orgId, body, profile)
          : key === "deals"
            ? await mergeDeals(supabase, orgId, body, profile)
          : key === "crmLeads"
            ? await mergeCrmLeads(supabase, orgId, body, profile)
            : key === "photos"
              ? await mergePhotos(supabase, orgId, body, profile)
              : body,
      );
      const nowIso = new Date().toISOString();
      // Compare-and-swap: when the client presents the version it last read
      // (x-store-if-version), the write only lands if the row still carries
      // that exact write-stamp — an ATOMIC conditional update, so two racing
      // devices can't both pass. A stale device gets a 409 with the current
      // board instead of overwriting it (the July 2026 clobber class). Clients
      // that don't send the header (older PWA copies) keep the old
      // last-write-wins upsert, so nothing breaks on deploy.
      const ifVersion = request.headers.get("x-store-if-version");
      if (ifVersion) {
        const { data: swapped, error: swapError } = await supabase
          .from("app_store")
          .update({ value: nextValue, updated_at: nowIso })
          .eq("org_id", orgId).eq("key", key).eq("updated_at", ifVersion)
          .select("updated_at");
        if (swapError) {
          console.error(`[store/${key}] CAS write failed:`, swapError.message);
          return NextResponse.json({ error: "Could not save data" }, { status: 500 });
        }
        if (swapped && swapped.length > 0) {
          return NextResponse.json({ ok: true, version: nowIso });
        }
        // No row matched: the version moved (someone else wrote), or the row
        // doesn't exist yet. Distinguish; a missing row is a legitimate first
        // write and proceeds below.
        const { data: current } = await supabase
          .from("app_store").select("value, updated_at").eq("org_id", orgId).eq("key", key).maybeSingle();
        if (current) {
          return NextResponse.json(
            {
              error: "version_conflict",
              version: String(current.updated_at),
              value: await filterForUser(supabase, orgId, key, current.value ?? null, profile),
            },
            { status: 409 },
          );
        }
      }
      const { error } = await supabase.from("app_store").upsert(
        { org_id: orgId, key: key, value: nextValue, updated_at: nowIso },
        { onConflict: "org_id,key" },
      );

      if (error) {
        console.error(`[store/${key}] write failed:`, error.message);
        return NextResponse.json({ error: "Could not save data" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, version: nowIso });
    }

    if (!ok) {
      return NextResponse.json({ error: "Secure store is not connected" }, { status: 503 });
    }

    const file = fileFor(key);
    await fs.mkdir(dataDir, { recursive: true });
    // Dev file store mirrors the CAS contract (version = file mtime) so the
    // conflict path is testable without Supabase.
    const devIfVersion = request.headers.get("x-store-if-version");
    if (devIfVersion) {
      const stat = await fs.stat(file).catch(() => null);
      if (stat && String(stat.mtimeMs) !== devIfVersion) {
        const text = await fs.readFile(file, "utf8").catch(() => "null");
        return NextResponse.json(
          { error: "version_conflict", version: String(stat.mtimeMs), value: JSON.parse(text) },
          { status: 409 },
        );
      }
    }
    await fs.writeFile(file, JSON.stringify(body, null, 2), "utf8");
    const stat = await fs.stat(file);
    return NextResponse.json({ ok: true, version: String(stat.mtimeMs) });
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid store key") {
      return NextResponse.json({ error: "Invalid store key" }, { status: 404 });
    }

    return NextResponse.json({ error: "Could not save data" }, { status: 500 });
  }
}

function normalizeRole(value?: string | null) {
  return normalizeAccessRole(value);
}

function profileKey(profile?: StoreProfile) {
  if (!profile) return "";
  const role = profile.role === "Admin" ? "Manager" : profile.role;
  return `${role}:${profile.employeeName}`;
}

function normalizeProfile(data: any, fallbackEmail: string): StoreProfile {
  const email = data?.email || fallbackEmail;
  const role = normalizeRole(data?.role);
  const employeeName = data?.employee_name || data?.display_name || email.split("@")[0] || "Employee";
  return { email, role, employeeName, orgId: data?.org_id || undefined };
}

async function readStore(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  orgId: string,
  key: string,
) {
  const { data } = await supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", key).maybeSingle();
  return data?.value;
}

async function myConversationIds(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  orgId: string,
  keyForUser: string,
): Promise<Set<string>> {
  const value = await readStore(supabase, orgId, "conversations");
  const convos = Array.isArray(value) ? value : [];
  return new Set(
    convos
      .filter((c: any) => Array.isArray(c.participants) && c.participants.includes(keyForUser))
      .map((c: any) => c.id),
  );
}

async function filterForUser(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  orgId: string,
  key: string,
  value: any,
  profile?: StoreProfile,
) {
  if (!profile || isAdmin(profile)) return value;
  // Owner-only company data — the personal executive OS and the Commissioned 41
  // sales pipeline. Never visible to staff or dealership tenants.
  if (key === "missionCore" || key === "hqPipeline") return null;
  if (key === "payplans" && Array.isArray(value)) {
    const role = profile.role === "BDC" ? "Sales" : profile.role;
    return value.filter((plan) => matchesPerson(plan.personName, profile.employeeName) && plan.role === role);
  }
  if (key === "conversations" && Array.isArray(value)) {
    const keyForUser = profileKey(profile);
    return value.filter((c) => Array.isArray(c.participants) && c.participants.includes(keyForUser));
  }
  if (key === "messages" && Array.isArray(value)) {
    const keyForUser = profileKey(profile);
    // Visible if it's a legacy 1:1 to/from me, OR it belongs to a conversation
    // (group or direct) that I'm a participant in.
    const myConvos = await myConversationIds(supabase, orgId, keyForUser);
    return value.filter(
      (message) =>
        message.from === keyForUser ||
        message.to === keyForUser ||
        (message.conversationId && myConvos.has(message.conversationId)),
    );
  }
  if (key === "crmLeads" && Array.isArray(value) && profile.role === "Sales") {
    return value.filter((lead) => matchesPerson(lead.salesperson, profile.employeeName));
  }
  if ((key === "deals" || key === "deals_backup") && Array.isArray(value) && (profile.role === "Sales" || profile.role === "BDC")) {
    // Every role can see the store-wide leaderboard, which only needs the
    // aggregate/financial fields. Customer PII on deals the user did not write
    // is redacted so reps cannot read other reps' customer identities — and the
    // backup snapshot is a full copy of the board, so it carries the SAME rule
    // (an unredacted backup would be a side door around the deals redaction).
    return value.map((deal) =>
      matchesPerson(deal.salesperson, profile.employeeName) ? deal : { ...deal, customer: "", vin: "", customerAddress: "" }
    );
  }
  if (key === "closedMonths" && Array.isArray(value) && (profile.role === "Sales" || profile.role === "BDC")) {
    // The archive carries whole months of deals — same PII rule as live deals:
    // redact customer/vin on archived deals the user didn't write.
    return value.map((month: any) => ({
      ...month,
      deals: Array.isArray(month?.deals)
        ? month.deals.map((deal: any) =>
            matchesPerson(deal.salesperson, profile.employeeName) ? deal : { ...deal, customer: "", vin: "", customerAddress: "" }
          )
        : month?.deals,
    }));
  }
  return value;
}

async function mergeMessages(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>, orgId: string, body: any, profile?: StoreProfile) {
  if (!profile) return body;
  const keyForUser = profileKey(profile);
  const incoming = Array.isArray(body) ? body : [];
  // A user may only create/modify messages they AUTHORED. Everyone else's
  // messages are preserved from the stored copy. This keeps group threads safe:
  // you can't inject a message that appears to come from a teammate. ADMINS
  // merge too — an admin's whole-array save racing a rep's send used to
  // silently drop the rep's message (last-write-wins for admins only).
  const allowedIncoming = incoming.filter((message) => message.from === keyForUser);
  const value = await readStore(supabase, orgId, "messages");
  const existing = Array.isArray(value) ? value : [];
  const untouched = existing.filter((message) => message.from !== keyForUser);
  const byId = new Map([...untouched, ...allowedIncoming].map((message) => [message.id, message]));
  return Array.from(byId.values());
}

async function mergeConversations(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>, orgId: string, body: any, profile?: StoreProfile) {
  // Admins merge like everyone else — see mergeMessages.
  if (!profile) return body;
  const keyForUser = profileKey(profile);
  const incoming = Array.isArray(body) ? body : [];
  const value = await readStore(supabase, orgId, "conversations");
  const existing = Array.isArray(value) ? value : [];
  const existingById = new Map(existing.map((c: any) => [c.id, c]));
  // Start from everything already stored, then apply the caller's writes:
  // they may create a NEW conversation they're a participant in, or update one
  // they created — but they can't tamper with a thread someone else owns.
  const result = new Map(existingById);
  for (const convo of incoming) {
    const iAmIn = Array.isArray(convo.participants) && convo.participants.includes(keyForUser);
    if (!iAmIn) continue;
    const prior: any = existingById.get(convo.id);
    if (!prior || prior.createdBy === keyForUser) result.set(convo.id, convo);
  }
  return Array.from(result.values());
}

async function mergeDeals(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>, orgId: string, body: any, profile?: StoreProfile) {
  if (!profile || isAdmin(profile) || profile.role === "Manager") return body;
  const incoming = Array.isArray(body) ? body : [];
  const value = await readStore(supabase, orgId, "deals");
  const existing = Array.isArray(value) ? value : [];

  if (profile.role !== "F&I") return existing;

  const allowedIncoming = incoming.filter((deal) => matchesPerson(deal.financeManager, profile.employeeName));
  const untouched = existing.filter((deal) => !matchesPerson(deal.financeManager, profile.employeeName));
  const byId = new Map([...untouched, ...allowedIncoming].map((deal) => [deal.id, deal]));
  return Array.from(byId.values());
}

async function mergeCrmLeads(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>, orgId: string, body: any, profile?: StoreProfile) {
  if (!profile || isAdmin(profile) || profile.role === "Manager" || profile.role === "F&I" || profile.role === "BDC") return body;
  const incoming = Array.isArray(body) ? body : [];
  const allowedIncoming = incoming.filter((lead) => matchesPerson(lead.salesperson, profile.employeeName));
  const value = await readStore(supabase, orgId, "crmLeads");
  const existing = Array.isArray(value) ? value : [];
  const untouched = existing.filter((lead) => !matchesPerson(lead.salesperson, profile.employeeName));
  const byId = new Map([...untouched, ...allowedIncoming].map((lead) => [lead.id, lead]));
  return Array.from(byId.values());
}

async function mergePhotos(supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>, orgId: string, body: any, profile?: StoreProfile) {
  if (!profile || isAdmin(profile) || profile.role === "Manager") return body;
  const keyForUser = profileKey(profile);
  const incoming = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const value = await readStore(supabase, orgId, "photos");
  const existing = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const next = { ...existing };

  if (Object.prototype.hasOwnProperty.call(incoming, keyForUser) && typeof incoming[keyForUser] === "string") {
    next[keyForUser] = incoming[keyForUser];
  } else {
    delete next[keyForUser];
  }

  return next;
}
