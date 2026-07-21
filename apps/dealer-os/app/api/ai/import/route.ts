import { NextResponse } from "next/server";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
import { linearizeExpandedLog } from "@/lib/dealImport";
import { team } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// AI parse of an uploaded report (possibly vision over multiple pages) can run
// well past the default timeout; give it headroom so a large import doesn't 504.
export const maxDuration = 60;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
// Same engine as the rest of EILA — the most capable model, because parsing a
// money log into structured deals is exactly where mistakes are expensive.
const IMPORT_MODEL = "claude-opus-4-8";

type Roster = { salespeople: string[]; managers: string[]; financeManagers: string[] };

// Kennesaw's seed roster — only used as the fallback for the default org or local
// dev. NEVER fed to a second tenant (that would mis-map their names to Kennesaw
// staff and leak those names), which is exactly what loadOrgRoster() guards.
const KENNESAW_ROSTER: Roster = {
  salespeople: team.filter((m) => m.role === "Sales" || m.role === "BDC").map((m) => m.name),
  managers: team.filter((m) => m.role === "Manager").map((m) => m.name),
  financeManagers: team.filter((m) => m.role === "F&I").map((m) => m.name),
};

// Intake is an owner/admin action only — it can rewrite the whole deal set.
// Returns the caller's org so the roster the parser maps names against is THIS
// store's, never a hardcoded one.
async function resolveImportCaller(req: Request): Promise<{ ok: boolean; orgId: string }> {
  const supabase = getSupabaseServerClient();
  // No secure backend wired (local dev) — allow so the screen is usable.
  if (!supabase) return { ok: process.env.NODE_ENV !== "production", orgId: DEFAULT_ORG_ID };
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, orgId: DEFAULT_ORG_ID };
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return { ok: false, orgId: DEFAULT_ORG_ID };
  const { data: profile } = await supabase
    .from("user_profiles").select("role, org_id").eq("id", data.user.id).maybeSingle();
  const orgId = profile?.org_id || DEFAULT_ORG_ID;
  const ok = isOwnerEmail(data.user.email) || normalizeAccessRole(profile?.role) === "Admin";
  return { ok, orgId };
}

// The roster the parser maps log names against = THIS org's saved `team` store
// key (same shape TeamProvider/EILA use). Falls back to Kennesaw's seed only for
// the default org or local dev; a second tenant with no roster yet gets an empty
// roster (parser keeps names verbatim) rather than Kennesaw's people.
async function loadOrgRoster(orgId: string): Promise<Roster> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return KENNESAW_ROSTER;
  const { data } = await supabase
    .from("app_store").select("value").eq("org_id", orgId).eq("key", "team").maybeSingle();
  const value = data?.value as Partial<Roster> | null | undefined;
  const salespeople = Array.isArray(value?.salespeople) ? value!.salespeople.filter(Boolean) : [];
  const managers = Array.isArray(value?.managers) ? value!.managers.filter(Boolean) : [];
  const financeManagers = Array.isArray(value?.financeManagers) ? value!.financeManagers.filter(Boolean) : [];
  if (salespeople.length || managers.length || financeManagers.length) {
    return { salespeople, managers, financeManagers };
  }
  // No saved roster: only the default org may borrow the Kennesaw seed.
  return orgId === DEFAULT_ORG_ID ? KENNESAW_ROSTER : { salespeople: [], managers: [], financeManagers: [] };
}

const SUBMIT_DEALS_TOOL = {
  name: "submit_deals",
  description: "Return the structured deals parsed from the pasted log.",
  input_schema: {
    type: "object",
    properties: {
      deals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dealNumber: { type: "string", description: "Deal #/stock log id if present" },
            date: { type: "string", description: "Deal date as YYYY-MM-DD" },
            customer: { type: "string", description: "Customer last name as shown" },
            stockNumber: { type: "string" },
            vehicle: { type: "string", description: "Year make model, e.g. '2024 Mazda CX-90'" },
            vehicleClass: { type: "string", enum: ["New", "Used", "Wholesale"] },
            salesperson: { type: "string", description: "FULL roster name" },
            salesperson2: { type: "string", description: "FULL roster name for a split, if any" },
            manager: { type: "string", description: "FULL roster name of the sales/desk manager" },
            financeManager: { type: "string", description: "FULL roster name" },
            lender: { type: "string" },
            term: { type: "number" },
            reserve: { type: "number", description: "Finance reserve portion of the back end" },
            backGross: { type: "number", description: "Total back-end gross (reserve + products)" },
            frontGross: { type: "number", description: "Front/commission gross EXCLUDING doc fee; negatives allowed" },
            docFee: { type: "number", description: "Doc fee if shown as its own column" },
            vin: { type: "string" },
            cashDeal: { type: "boolean" },
            financeStatus: { type: "string", enum: ["Classified", "Not Classified", "DNQ"] },
            totalGross: { type: "number", description: "The row's printed TOTAL gross column exactly as shown, when the log prints one. Used to verify extraction. Omit if the log has no per-row total." },
            products: {
              type: "object",
              description: "Only when the source shows products per deal (check/x columns). Omit otherwise.",
              properties: {
                vsc: { type: "boolean" },
                gap: { type: "boolean" },
                maintenance: { type: "boolean" },
                permaplate: { type: "boolean" },
                tws: { type: "boolean" },
                utp: { type: "boolean", description: "The 5-unit product (a.k.a. NAS Combo)" },
              },
            },
          },
          required: ["customer"],
        },
      },
      summary: { type: "string", description: "One line: how many deals and any rows you were unsure about." },
    },
    required: ["deals"],
  },
} as const;

function rosterPrompt(roster: Roster) {
  const { salespeople, managers, financeManagers } = roster;
  // A brand-new tenant may not have configured its roster yet. Without names to
  // map to, keep every name exactly as written — NEVER guess against some other
  // store's people.
  if (!salespeople.length && !managers.length && !financeManagers.length) {
    return `STORE ROSTER — none on file for this store. Keep every salesperson/manager/finance-manager name EXACTLY as it appears in the log (do not normalize, expand, or map it to anyone).`;
  }
  return `STORE ROSTER — map every name in the log to one of these EXACT full names.
Salespeople: ${salespeople.join(", ") || "(none on file)"}.
Sales managers: ${managers.join(", ") || "(none on file)"}.
Finance managers: ${financeManagers.join(", ") || "(none on file)"}.
Logs usually show last-name-only or first-name-only — match each to the EXACT full roster name above (e.g. a row showing just "SMITH" or "JOHN" maps to the matching full name on the roster). A nickname or legal-name variant maps to the roster name (e.g. a formal first name in the log → the roster's preferred name for that same person). If a name is clearly NOT on the roster (e.g. "HOUSE EMPLOYEE", "HOUSE"), keep it verbatim — do not force it onto a roster name.`;
}

const SYSTEM = `You are EILA, the data-intake engine inside Dealer Mission OS. You convert a pasted dealership deal log into clean structured deals. The paste may be a polished DMS export (Reynolds F&I Manager Deal Log) or a rough phone dump of "we did these cars today." Extract EVERY real deal row.

RULES:
- Output ONLY via the submit_deals tool. One object per deal.
- Money: strip $ and commas. Parentheses mean NEGATIVE: "(1,705)" = -1705. A dash "-" or blank = 0.
- backGross = the deal's total BACK column (reserve + products), NOT just the reserve. reserve = the finance reserve line ("Fin Res" / "Reserve") if shown.
- frontGross = the front/commission gross EXCLUDING doc fee. If the source has a separate "Comm. Gross" and "Doc Fee", frontGross = the commission gross and docFee = the doc fee. (Some sheets show a "Front Gross" that already bundles the doc fee — do NOT use that for frontGross; use the commission gross.) Total gross = front + back + doc fee.
- vehicleClass: "New"/"N" = New, "Used"/"U" = Used, wholesale = Wholesale.
- financeStatus + cash: lender "CASH"/"***CASH***" -> cashDeal true, financeStatus "Not Classified". A row marked "Do Not Qualify"/"DNQ" -> financeStatus "DNQ" (and infer vehicleClass New/Used from the vehicle, since "Do Not Qualify" is a status, not a vehicle type). Everything else -> financeStatus "Classified".
- PRODUCTS: if the source has per-deal product columns with check/x marks (✔/✓/Y = sold, ✘/✗/X/blank = not sold), set the products object. Mapping: VSC->vsc, GAP->gap, Maint/Maintenance->maintenance, "NAS Combo"->utp (the 5-unit product), "Other"->permaplate. Omit products entirely for logs that don't show them per deal.
- date -> YYYY-MM-DD (assume the year shown; "6/1/26" = 2026-06-01).
- Map salesperson/salesperson2/manager/financeManager to the roster full names provided below. First-name-only or last-name-only both map to the full roster name (e.g. a log showing just "PAUL" maps to the roster entry whose first name is Paul). Use ONLY the roster supplied in this request — never a name from any other store.
- totalGross: when the log prints a per-row TOTAL gross column, copy it exactly as shown (it should equal front + back + doc fee). It exists to verify your extraction. Omit when the log has no per-row total.
- Lines beginning "DEAL ROW:" are pre-grouped for you — each such line is EXACTLY ONE deal's fields in order, pipe-separated. Never split one across deals or merge two.
- Do NOT invent rows, and do NOT include report subtotal/total lines ("Totals:", "Report Totals:", "PVR:") as deals.`;

export async function POST(req: Request) {
  try {
    const { ok, orgId } = await resolveImportCaller(req);
    if (!ok) {
      return NextResponse.json({ error: "Import is available to owners/admins only." }, { status: 403 });
    }
    const rl = await rateLimit(clientKey(req, orgId), { limit: 10, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);
    const { text } = (await req.json()) as { text?: string };
    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Paste a deal log first." }, { status: 400 });
    }
    // A month's deal log is a few tens of KB; cap well above that to bound cost.
    if (text.length > 300_000) {
      return NextResponse.json({ error: "That's too large to parse at once — split it into smaller batches." }, { status: 413 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Add ANTHROPIC_API_KEY to your Vercel environment variables and redeploy." },
        { status: 500 }
      );
    }

    const roster = await loadOrgRoster(orgId);

    // A mobile "expanded rows" paste scatters one deal across ~20 lines — the
    // format where field-to-deal association goes wrong. Deterministically
    // rebuild it as one line per deal first; every other paste flows through
    // byte-identical (linearizeExpandedLog returns null).
    const linearized = linearizeExpandedLog(text);
    const effectiveText = linearized ?? text;

    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: IMPORT_MODEL,
        max_tokens: 16000,
        system: `${SYSTEM}\n\n${rosterPrompt(roster)}`,
        tools: [SUBMIT_DEALS_TOOL],
        tool_choice: { type: "tool", name: "submit_deals" },
        messages: [{ role: "user", content: `Parse this deal log into structured deals:\n\n${effectiveText}` }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: `EILA couldn't parse that (${res.status}). ${detail.slice(0, 200)}` }, { status: 502 });
    }

    const json = await res.json();
    const toolUse = (json.content || []).find((b: { type: string }) => b.type === "tool_use");
    if (!toolUse?.input?.deals) {
      return NextResponse.json({ error: "EILA didn't find any deals in that paste." }, { status: 422 });
    }
    // A REAL deal has a customer or money on it. When a paste contains no deal
    // data (a file reference, a screenshot caption, an empty export), the model
    // sometimes returns one hollow placeholder row — filter those out, and if
    // nothing real remains, surface an error instead of a phantom review table.
    const deals = (toolUse.input.deals as Array<Record<string, unknown>>).filter((d) => {
      const customer = typeof d.customer === "string" ? d.customer.trim() : "";
      const named = customer && !/^(unknown|n\/a|none|-)$/i.test(customer);
      const money = [d.frontGross, d.backGross, d.reserve, d.totalGross].some(
        (v) => typeof v === "number" && v !== 0
      );
      return named || money;
    });
    if (!deals.length) {
      const why = typeof toolUse.input.summary === "string" && toolUse.input.summary.trim() ? ` ${toolUse.input.summary.trim()}` : "";
      return NextResponse.json({ error: `EILA couldn't find any real deals in that paste.${why}` }, { status: 422 });
    }
    return NextResponse.json({ deals, summary: toolUse.input.summary ?? "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
