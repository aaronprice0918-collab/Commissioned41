import { NextResponse } from "next/server";
import { getSessionEmail, hasActiveSubscription } from "@/lib/entitlement";
import { rateLimited } from "@/lib/rateLimit";

// EILA reads bank statements (photo or PDF, up to 3 months) and extracts the
// rep's money pattern: recurring bills on autopay, rough spending habits by
// category, and the latest ending balance. The Plaid bridge until Plaid —
// same gate/throttle/size posture as scan-recap/parse-payplan. She SUGGESTS;
// the user reviews and approves before anything touches their Money picture.
// The statement itself is read and discarded — never stored.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const IS_PROD = process.env.NODE_ENV === "production" || !!process.env.VERCEL; // any Vercel deploy (previews too) enforces the gate — only true local dev gets the convenience pass
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 6;

const MAX_FILE_BYTES = 6_000_000; // per file, base64 length
const MAX_FILES = 6;
const MAX_TOTAL_BYTES = 20_000_000; // combined cap — same belt as parse-payplan

const PROMPT = `You are reading one or more BANK STATEMENTS (checking account) for the same person — photos or PDFs, possibly covering several months AND possibly from DIFFERENT banks/accounts belonging to the same person (a bills account at one bank, a spending account at another). Combine everything into ONE picture of their money pattern: merge bills across all accounts (dedupe the same payee), sum variable spending across accounts, and use the most recent PRIMARY checking statement's ending balance.

Respond with ONLY a JSON object — no prose, no code fences — with exactly these keys:
{
  "bills": [{ "name": "", "amount": 0, "dayOfMonth": 1, "isSubscription": false }],
  "monthlySpend": 0,
  "endingBalance": 0,
  "savingsBalance": 0,
  "statementEndDate": "",
  "monthsAnalyzed": 1,
  "categories": [{ "name": "", "monthly": 0 }],
  "incomeDeposits": [{ "name": "", "amount": 0, "dayOfMonth": 1 }]
}

Rules:
- bills = EVERY recurring obligation. Recurring means the SAME merchant/payee on a regular cadence — the amount does NOT need to match month to month (utilities, insurance, phone, credit-card payments, and childcare all vary; use the average and still include them). Sweep thoroughly: rent/mortgage, vehicle loans, insurance of every kind, utilities (power/water/gas/trash), phone, internet, streaming and every small subscription, gym, loan/card payments, tithes/giving, childcare. A typical statement set has 10–20 of these — be complete, not conservative. With multiple months, a charge appearing in 2+ months is definitely a bill; with a single month, include everything that is clearly recurring by nature. Use the merchant's plain name ("Netflix", "Truck payment", "State Farm"), the average amount, and the day of month it usually lands. isSubscription = streaming/software/memberships.
- Do NOT list one-off purchases (restaurants, gas fill-ups, Amazon orders) as bills.
- monthlySpend = average TOTAL monthly outflow EXCLUDING the recurring bills above and excluding transfers to savings/investments — the person's everyday variable spending (food, fuel, shopping, life).
- categories = 3-6 rough buckets of that variable spending ("Food & dining", "Fuel", "Shopping", ...) with average monthly amounts.
- endingBalance = the ending/closing balance of the MOST RECENT statement — the CHECKING account only.
- statementEndDate = the closing/period-end DATE of that most-recent statement the endingBalance is from, as YYYY-MM-DD (e.g. "2026-06-30"). This is the date that balance was true — it may be weeks before today. Use "" if you can't read it.
- savingsBalance = the combined ending balance of any SAVINGS / money-market / reserve accounts visible across the statements (0 when none are shown). Never mix it into endingBalance.
- monthsAnalyzed = how many distinct statement months you can see.
- incomeDeposits = recurring credits that look like paychecks/commission deposits (employer name if visible, typical amount, usual day).
- All amounts are positive numbers, no $ or commas. Round to whole dollars.
- Be faithful to the document; never invent. Use 0/[]/"" when absent or unreadable.
- If the files are clearly NOT bank statements, respond with {"error":"not a bank statement"}.`;

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

type InFile = { dataB64?: string; mediaType?: string };

export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const email = await getSessionEmail(token);
    if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    if (await rateLimited(`scan-statement:${email}`, RATE_WINDOW_MS, RATE_MAX)) {
      return NextResponse.json({ error: "Too many scans. Try again shortly." }, { status: 429 });
    }

    let active = false;
    try { active = await hasActiveSubscription(email); } catch { active = false; }
    if (!active && IS_PROD) return NextResponse.json({ error: "Subscription required." }, { status: 402 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "The statement reader isn't configured." }, { status: 503 });

    const body = (await req.json().catch(() => ({}))) as { files?: InFile[] };
    const files = (Array.isArray(body.files) ? body.files : []).slice(0, MAX_FILES);
    if (!files.length) return NextResponse.json({ error: "No statement was sent." }, { status: 400 });
    const totalBytes = files.reduce((s, f) => s + String(f.dataB64 || "").length, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json({ error: "Those files are too large together — try fewer pages per scan." }, { status: 413 });
    }

    const blocks: unknown[] = [];
    for (const f of files) {
      const data = String(f.dataB64 || "");
      const mediaType = String(f.mediaType || "");
      if (!data) continue;
      if (data.length > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "One of the files is too large — a clear photo of each page works better than a huge scan." }, { status: 413 });
      }
      if (mediaType === "application/pdf") {
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
      } else if (/^image\/(jpeg|png|webp)$/.test(mediaType)) {
        blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
      }
    }
    if (!blocks.length) return NextResponse.json({ error: "No usable statement file was sent — use a photo or a PDF." }, { status: 400 });

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3500,
        messages: [{ role: "user", content: [...blocks, { type: "text", text: PROMPT }] }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: "EILA couldn't read that one — try a sharper photo or the PDF from your bank's app." }, { status: 502 });

    const out = await res.json();
    const textBlock = Array.isArray(out?.content) ? out.content.find((c: { type?: string }) => c?.type === "text") : null;
    const fields = extractJson(textBlock?.text || "");
    if (!fields || (fields as { error?: string }).error) {
      return NextResponse.json({ error: "That didn't look like a bank statement. The PDF from your bank's app or site reads best." }, { status: 422 });
    }

    const num = (v: unknown) => {
      const n = typeof v === "number" && isFinite(v) ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
      return isFinite(n) ? Math.round(Math.abs(n)) : 0;
    };
    const str = (v: unknown) => String(v ?? "").trim().slice(0, 60);
    const day = (v: unknown) => Math.min(31, Math.max(1, num(v) || 1));

    const bills = (Array.isArray(fields.bills) ? fields.bills : [])
      .slice(0, 40)
      .map((b: Record<string, unknown>) => ({
        name: str(b.name),
        amount: num(b.amount),
        dayOfMonth: day(b.dayOfMonth),
        isSubscription: !!b.isSubscription,
      }))
      .filter((b) => b.name && b.amount > 0);

    const categories = (Array.isArray(fields.categories) ? fields.categories : [])
      .slice(0, 8)
      .map((c: Record<string, unknown>) => ({ name: str(c.name), monthly: num(c.monthly) }))
      .filter((c) => c.name && c.monthly > 0);

    const incomeDeposits = (Array.isArray(fields.incomeDeposits) ? fields.incomeDeposits : [])
      .slice(0, 6)
      .map((d: Record<string, unknown>) => ({ name: str(d.name), amount: num(d.amount), dayOfMonth: day(d.dayOfMonth) }))
      .filter((d) => d.amount > 0);

    const rawEndDate = typeof fields.statementEndDate === "string" ? fields.statementEndDate.trim() : "";
    const statementEndDate = /^\d{4}-\d{2}-\d{2}$/.test(rawEndDate) ? rawEndDate : undefined;

    return NextResponse.json({
      bills,
      monthlySpend: num(fields.monthlySpend),
      endingBalance: num(fields.endingBalance),
      savingsBalance: num(fields.savingsBalance),
      statementEndDate,
      monthsAnalyzed: Math.min(MAX_FILES, Math.max(1, num(fields.monthsAnalyzed) || 1)),
      categories,
      incomeDeposits,
    });
  } catch (e) {
    console.error("[scan-statement]", e);
    return NextResponse.json({ error: "Something went wrong reading the statement — try again." }, { status: 500 });
  }
}
