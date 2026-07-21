import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCompEmail, isOwner } from "./entitlement";
import { ENTITLEMENTS_TABLE } from "./supabaseAdmin";

// The single source of truth for "how's the business doing" — computed once,
// shared by the Owner Pulse page and Owner EILA's chat, so Aaron never gets
// two different answers to the same question.

export interface PulsePerson {
  email: string;
  created: string;
  lastSignIn: string | null;
  status: "owner" | "paying" | "trial" | "team" | "free";
}

export interface OwnerPulse {
  summary: {
    real: number; internal: number; paying: number; trial: number; team: number; free: number;
    activeToday: number; active7: number; quiet: number;
  };
  spark: { day: string; n: number }[];
  people: PulsePerson[]; // real accounts, newest first, capped
}

const DAY = 86_400_000;

// Accounts that are clearly ours (tests / verification), kept out of the real
// customer counts but still counted separately so nothing hides.
function isInternal(email: string): boolean {
  const e = email.toLowerCase();
  return (
    e.endsWith("@example.com") ||
    /\+\d{8,}/.test(e) ||
    /(^|[._+-])(gate|verify|harden|confirmtest|ila-verify|smoketest|e2e)/.test(e) ||
    e === "aaron.verify@gmail.com" ||
    e.startsWith("missionoslite+")
  );
}

export async function computeOwnerPulse(admin: SupabaseClient): Promise<OwnerPulse> {
  const { data: userData, error: uErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (uErr) throw new Error(uErr.message);
  const { data: entRows, error: eErr } = await admin.from(ENTITLEMENTS_TABLE).select("email,status,entitled");
  if (eErr) throw new Error(eErr.message);

  const entByEmail = new Map<string, { status: string; entitled: boolean }>();
  for (const r of (entRows ?? []) as { email: string; status: string; entitled: boolean }[]) {
    if (r.email) entByEmail.set(r.email.toLowerCase(), { status: r.status, entitled: !!r.entitled });
  }

  const now = Date.now();
  type Row = PulsePerson & { internal: boolean };
  const rows: Row[] = (userData.users ?? []).map((u) => {
    const em = (u.email ?? "").toLowerCase();
    const ent = entByEmail.get(em);
    const status: PulsePerson["status"] = isOwner(em) ? "owner"
      : ent?.status === "active" ? "paying"
      : ent?.status === "trialing" ? "trial"
      : ent?.status === "comped" ? "team"
      : isCompEmail(em) ? "team"
      : "free";
    return { email: u.email ?? "", created: u.created_at ?? "", lastSignIn: u.last_sign_in_at ?? null, status, internal: isInternal(em) };
  });

  const real = rows.filter((r) => !r.internal);
  const activeSince = (r: Row, days: number) => !!r.lastSignIn && now - new Date(r.lastSignIn).getTime() < days * DAY;
  const quiet = (r: Row) =>
    now - new Date(r.created).getTime() > 2 * DAY && (!r.lastSignIn || now - new Date(r.lastSignIn).getTime() > 3 * DAY);

  const spark: { day: string; n: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const key = new Date(now - i * DAY).toISOString().slice(0, 10);
    spark.push({ day: key, n: real.filter((r) => r.created.slice(0, 10) === key).length });
  }

  const count = (s: string) => real.filter((r) => r.status === s).length;
  const summary = {
    real: real.length,
    internal: rows.length - real.length,
    paying: count("paying"),
    trial: count("trial"),
    team: count("team"),
    free: count("free"),
    activeToday: real.filter((r) => activeSince(r, 1)).length,
    active7: real.filter((r) => activeSince(r, 7)).length,
    quiet: real.filter(quiet).length,
  };

  const people = real
    .sort((a, b) => (b.created > a.created ? 1 : -1))
    .slice(0, 60)
    .map(({ email, created, lastSignIn, status }) => ({ email, created, lastSignIn, status }));

  return { summary, spark, people };
}
