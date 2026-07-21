import { NextResponse } from "next/server";
import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Contact-form handler. Same fail-soft philosophy as /api/join — the visitor
// always gets a success as long as the payload is valid:
//   1. Supabase  — durable storage (gated on env vars)
//   2. Resend    — notification email to the team (gated on env vars)
//   3. JSONL file — local fallback, always attempted
// Set env vars (see .env.example) to switch on 1 and 2 in production.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONTACT_TABLE = process.env.CONTACT_TABLE || "contact_messages";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const CONTACT_TO = process.env.CONTACT_TO; // where inbound messages are forwarded

const INTERESTS = ["lite", "dealer", "general"] as const;
type Interest = (typeof INTERESTS)[number];

const INTEREST_LABEL: Record<Interest, string> = {
  lite: "EILA",
  dealer: "Dealer Mission OS",
  general: "General Commissioned 41 Inquiry",
};

interface ContactPayload {
  name: string;
  email: string;
  interest: Interest;
  message: string;
}

async function saveToSupabase(p: ContactPayload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { error } = await supabase.from(CONTACT_TABLE).insert({ ...p, source: "brand-site" });
  if (error) throw error;
  return true;
}

async function notifyTeam(p: ContactPayload) {
  if (!RESEND_API_KEY || !EMAIL_FROM || !CONTACT_TO) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: CONTACT_TO,
      reply_to: p.email,
      subject: `New inquiry — ${INTEREST_LABEL[p.interest]} — ${p.name}`,
      text:
        `Name: ${p.name}\n` +
        `Email: ${p.email}\n` +
        `Interest: ${INTEREST_LABEL[p.interest]}\n\n` +
        `${p.message}\n`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
  return true;
}

async function appendToFile(p: ContactPayload) {
  const dir = path.join(process.cwd(), ".data");
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify({ ...p, at: new Date().toISOString() }) + "\n";
  await appendFile(path.join(dir, "contact-messages.jsonl"), line, "utf8");
}

export async function POST(req: Request) {
  if (!rateLimit(clientIp(req), 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many requests, try again later." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const message = String(body?.message ?? "").trim();
  const rawInterest = String(body?.interest ?? "general");
  const interest: Interest = (INTERESTS as readonly string[]).includes(rawInterest)
    ? (rawInterest as Interest)
    : "general";

  if (name.length > 120 || email.length > 200 || message.length > 5000) {
    return NextResponse.json({ ok: false, error: "field too long" }, { status: 400 });
  }

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || !validEmail || !message) {
    return NextResponse.json({ ok: false, error: "missing or invalid fields" }, { status: 400 });
  }

  const payload: ContactPayload = { name, email, interest, message };

  const results = await Promise.allSettled([
    saveToSupabase(payload),
    notifyTeam(payload),
    appendToFile(payload),
  ]);
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[contact] layer ${["supabase", "resend", "file"][i]} failed:`, r.reason);
    }
  });

  return NextResponse.json({ ok: true });
}
