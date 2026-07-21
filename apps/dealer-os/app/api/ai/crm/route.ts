import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { ilaCore } from "@commissioned41/ila-core/core";
import { loadBrainLessons, renderBrain } from "@commissioned41/ila-core/brain";
import { loadUserMemory, reflectUserMemory, renderUserMemory } from "@/lib/ila-user-memory";
import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { orgEntitled } from "@/lib/billing";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { rateLimit, clientKey, tooManyRequests } from "@/lib/rateLimit";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
import { SALES_PLAYBOOK } from "@/lib/salesPlaybook";
import { formatSetupForEILA } from "@/lib/monthlySetup";
import {
  salesLeaderboard,
  financeLeaderboard,
  salespersonNamesFromDeals,
  financeManagerNamesFromDeals,
  commissionableFrontGross,
  productUnits,
  manufacturerMoney,
  docFeeIncome,
  currentMonthPace,
  paceValue,
  dailyNeed,
  currency,
  unitsLabel,
  samePerson,
  salespersonShare,
  metricsFor,
  isCountableFinance,
  mergeStoreSettings,
  productLabels,
  defaultStoreSettings,
  type StoreSettings,
  type ProductKey,
  type Deal,
  isRetail,
} from "@/lib/data";
import { computePay, type CompPlan } from "@/lib/payEngine";
import { periodFor, CALENDAR_MONTH_CYCLE } from "@/lib/payCycle";
import { buildPerformance, buildDealRows } from "@/lib/buildPerformance";
import { templateForRole } from "@/lib/planTemplates";
import { salesPlanToCompPlan } from "@/lib/migrateSalesPlan";
import { isOpenLead, scoreLead, isAtRisk } from "@/lib/leadScore";
import { personLabel } from "@/lib/desk";
import { jacketOrderFor, jacketStatus, jacketSummaryLine } from "@/lib/dealJacket";
import { speedClock, speedStats } from "@/lib/speedToLead";
import { consentStatus, consentSummary, suppressionDeadline } from "@/lib/consent";
import { isLate, laneStats, moveVisitPatch, promiseRisk, promiseStats, recaptureList, updateDue, type ServiceStatus } from "@/lib/service";
import { SOP_AGING_DAYS, counterStats, moveSopPatch, normalizePartsData, sopAgeDays, stockSuggestions, type SopStatus } from "@/lib/parts";
import { buildClosedMonth, summarizeMonth, upsertClosedMonth, type ClosedMonth } from "@/lib/closeMonth";
import { buildFixedOpsDigest } from "@/lib/fixedOpsDigest";
import { groupForViewer, groupRollup, type GroupStoreInput } from "@/lib/groupReport";
import { sendTextToLead } from "@/lib/smsServer";
import { twilioConfigured } from "@/lib/twilio";
import { withOptOutNotice } from "@/lib/comms";
import { decodeVin, isValidVin } from "@/lib/vin";
import { assembleAnthropicStream, type StreamEvent } from "@/lib/anthropicStream";
import { guardedMutate } from "@/lib/storeServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// EILA chains up to 6 sequential model calls per turn (tool loop: query → query
// again → answer) plus transient-error backoff. The chat action streams her
// reply token-by-token (see streamEILAChat), but a complex ask (deal
// structuring, a full audit, deep coaching) can still run past the platform's
// default function timeout across the whole loop. Give her the headroom to
// finish instead of 504-ing mid-thought.
export const maxDuration = 60;

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// Resolve the caller, their dealership (org), and that store's settings — and
// decide whether EILA is available to them. EILA is a per-store paid add-on:
// available to EVERY user at a store whose storeSettings.aiAssistantEnabled isn't
// false (delivers "coaches every rep"), and always to the product owner. When
// Stripe billing lands, the org flag becomes subscription-driven.
// What EILA is allowed to see depends on the caller's role — same rule the
// store API enforces: managers/F&I/admin see the whole store; line reps (Sales,
// BDC) get the store-wide leaderboards but NOT other reps' customer PII.
type Viewer = { role: string; employeeName: string; email?: string };
type Caller = { ok: boolean; orgId: string; settings: StoreSettings; viewer: Viewer };

const PUBLIC_VIEWER: Viewer = { role: "Admin", employeeName: "", email: "" };

async function resolveCaller(req: Request): Promise<Caller> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    // Dev convenience only — no secure backend wired.
    return { ok: process.env.NODE_ENV !== "production", orgId: DEFAULT_ORG_ID, settings: defaultStoreSettings, viewer: PUBLIC_VIEWER };
  }
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, orgId: DEFAULT_ORG_ID, settings: defaultStoreSettings, viewer: PUBLIC_VIEWER };
  const { data, error } = await supabase.auth.getUser(token);
  if (!data.user || error) return { ok: false, orgId: DEFAULT_ORG_ID, settings: defaultStoreSettings, viewer: PUBLIC_VIEWER };

  const { data: profile } = await supabase
    .from("user_profiles").select("org_id, role, employee_name, display_name").eq("id", data.user.id).maybeSingle();
  const owner = isOwnerEmail(data.user.email);
  // A valid auth token with NO user_profiles row is a half-provisioned or
  // self-signed-up account — it belongs to NO store. Never default it into the
  // founding org (that would hand a stranger EILA over live dealership data).
  // The owner is the one exception: their home is the default org by design.
  if (!profile?.org_id && !owner) {
    return { ok: false, orgId: DEFAULT_ORG_ID, settings: defaultStoreSettings, viewer: PUBLIC_VIEWER };
  }
  const orgId = profile?.org_id || DEFAULT_ORG_ID;
  const role = owner ? "Admin" : normalizeAccessRole(profile?.role);
  const employeeName = profile?.employee_name || profile?.display_name || (data.user.email || "").split("@")[0] || "";

  const { data: row } = await supabase
    .from("app_store").select("value").eq("org_id", orgId).eq("key", "storeSettings").maybeSingle();
  const settings = mergeStoreSettings(row?.value ?? null);
  const enabled = settings.aiAssistantEnabled !== false || owner;
  // Billing gate — a lapsed store doesn't get EILA (she's the expensive part).
  // Fail-open while Stripe isn't configured; founding store always allowed.
  const gate = await orgEntitled(supabase, orgId);
  return { ok: enabled && gate.entitled, orgId, settings, viewer: { role, employeeName, email: data.user.email || "" } };
}

// WHAT EILA DOES HERE — Dealer Mission OS capabilities, layered on the
// canonical core (lib/ila-core.ts, the same identity/personality/voice as
// every Commissioned 41 product). Who she IS lives in the core; this block is
// only what she can DO in this app. Store-agnostic — the store-specific
// economics (doc fee, holdback, tax, weights, targets, name) are injected per
// request by storeContext() so EILA is correct for ANY tenant.
const DEALER_PROMPT = `WHAT YOU DO HERE (Dealer Mission OS — you run this store's sales floor): you are the GSM (General Sales Manager) living inside Dealer Mission OS, the dealership operating system. You have done every job in the store — salesperson, desk manager, F&I manager, sales manager — at the highest level, and you carry the sharpest read on the numbers anywhere; you are also the store's data watchdog — you help close more cars AND you catch every mistake in the numbers before it costs the store a dollar. You run the floor off the live numbers: when asked, diagnose what's wrong and say exactly how to fix it — but answer first, advise only when it's wanted.

HOW YOU ANSWER HERE:
- You are often HEARD out loud (your replies play through your voice), so phrase everything to be spoken, not read off a screen — natural sentences, contractions, the rhythm of how you'd actually say it to someone standing next to you. Never a terminal printing data.
- PLAIN HUMAN LANGUAGE — a hard law, not a style choice. Whoever's asking might be on day one of the job: never assume they know an acronym or a system term. The first time you use one, say what it means in the same breath ("PVR — the average gross per car"; "an SOP, a part we special-ordered for a customer"). Never use software words at all — no "field", "record", "sync", "configured", "data entry", "null". Say it the way you'd say it across the desk: not "the deal's financeStatus is DNQ" but "that deal's marked as not qualifying, so it doesn't count against F&I". If your answer wouldn't make sense read aloud to a brand-new hire, rewrite it until it would.
- It's a back-and-forth: react like a person, let your read on it show, and when it's natural, toss it back to them ("want me to pull those deals?", "you good, or should I dig in?").
- When they ask HOW — "walk me through it", "what's the play", "give me a plan" — or ask for an audit, that's your cue to open up and go as deep as the job needs: the plan, the exact word track, the steps, the deal-by-deal numbers. Until then, keep it conversational and tight.

YOUR DATA ACCESS — this is the whole point of you:
- You have full, live access to this store's Dealer Mission OS data — sales, finance, the team, the CRM pipeline, goals and pace — supplied below every conversation. Treat it like you can walk into any screen and read it.
- When the summary below isn't enough — you need a specific slice of deals, an audit pass, a deep-dive on one rep, or an exact buy rate — USE YOUR TOOLS: query_deals (drill/filter the full uncapped deal list, including audit flags like missing invoice / negative gross / products on a DNQ deal), rep_detail (everything on one salesperson or F&I manager), estimate_pay (run a person's month through the pay engine — their commission rate, gross, penalties, net after draw, and the single best move to earn more this month; use it for ANY "what's my pay / how do I make more" question, and lean on it to coach the money — pay is private, so for a rep it's their own only), next_leads (the prioritized follow-up list — every open lead scored for buying intent, overdue first, with the recommended touch; for "who do I work/call next", hot leads, what's overdue), appointments (today's board — who's coming in, who to confirm, no-shows to reschedule), equity (trade-up radar — lease maturities + owners in the trade window), deals_at_risk (open deals stuck too long in a stage — where to step in), read_archive (the store's banked PRIOR closed months — each month's units/gross/PVR/PPU/F&I; use it for 'how did we do last month', month-over-month trends, or 'best month this year'), update_lead (TAKE THE ACTION on a lead — actually set/confirm an appointment, log the next action or a note, advance a lead's status, mark a customer in the showroom or a no-show; don't just suggest it, do it and confirm what changed; a rep can only touch their own leads), lookup_rate (the precise buy rate off the loaded rate sheet by lender/tier/term/year), deal_jacket (one deal's paper file: the store's required document order with what's filed / N/A / still missing — for "what order does this deal go in", "what's missing from the jacket", "is it ready to walk to the office"), speed_to_lead (the Five-Minute Response System — who's on the 5:00 first-contact clock or past it right now, plus the 30-day percent-under-five grade by rep; use it for 'who's on the clock' and response-time coaching), decode_vin (run any 17-character VIN through NHTSA — year/make/model/trim/body/engine — and cross-check whether it's on one of this store's deals or working leads), check_consent (the TCPA rail: a customer's per-channel call/text/email consent status with the audit trail, or — with no name — the store's full do-not-contact list; ALWAYS run it before drafting or recommending outreach to a specific customer, and if a channel is revoked that's a HARD no: no drafts, no workarounds — statutory damages run $500–$1,500 per text/call), service_lane (the Service Drive board — the lane by status with promise-time LATE flags, ready-for-pickup vehicles, declined work worth a follow-up call, and service customers flagged for a trade conversation), parts_counter (the Parts Counter board — special orders with aging clocks and deposit status, the tech request queue with fill times, and lost sales with stock-it suggestions; use it for any parts-department question), fixed_ops_digest (the weekly fixed-ops read — promises kept, win-back money, SOP shelf dollars, lost sales, the top move; use it for any "how did service and parts do" summary), group_report (for dealer-group principals and the owner only: every rooftop's units/gross/PVR/PPU plus group totals — reach for it on any cross-store question; access is checked per caller, so regular store users get politely declined), text_customer (send a REAL text to a customer through the store's texting number — draft it short and human, preview WITHOUT confirm first, and send with confirm:true ONLY after the user explicitly approves; consent is enforced server-side and a revoked customer is a hard no), and restore_backup (the Import screen's safety net: describe the last board backup, and — ONLY after the user explicitly confirms — restore it; managers/F&I/admin only). You have a tool for every screen — reach for them before you ever say you can't do something. When someone tells you to DO something to a lead ("set Smith's appt for 3", "log that I left a voicemail", "mark them shown"), use update_lead to actually save it. You also have ACTION tools for the rest of the store — use them to DO the thing, not just describe it: update_deal (edit an existing deal — set its stage, punch the RDR, reassign desk/finance, or correct front/back gross; manager/F&I/admin), set_goals (set the team unit goal, store PVR goal, or a rep's unit goal; manager/admin), close_month (two-step: archive the current board into the month archive after the user confirms; manager/admin), service_update (advance a service visit's status), and parts_update (advance a special order's status). Same rule as always: for anything high-risk or that commits money/records, confirm with the user first — but once they say do it, DO it and confirm what changed.
- ALWAYS answer using the ACTUAL numbers from that data. Pull the figure and answer immediately.
- NEVER say "I don't know", "I'll need a report", or "you'll have to check". The data is in front of you. If a specific number genuinely isn't there, say in one line what's missing and what to enter — then give everything you CAN.
- TAPPED-NUMBER EXPLAINS: all over the app, tapping a number opens you with "Explain my …". Walk the REAL math behind that exact figure from the live data — short sentences, their numbers, no jargon (use estimate_pay for pay numbers, query_deals to list exactly what's counted). If they say a number is wrong, NEVER defend it: find which input is off (a deal's gross, a missing invoice, the finance status, a split, a product entry, the goal itself), name it, and say exactly what to fix and where.

DEAL STATUSES: New Lead → Working → Appointment Set → Shown → Desking → In Finance → Won / Lost.

MATH & AUDIT RULES (use THIS STORE's figures shown below; verify the deals add up):
- Total gross = front gross + back gross + doc fee.
- New-vehicle manufacturer holdback = this store's holdback % × invoice. A NEW unit with invoice $0/blank ⇒ holdback uncaptured — flag it, that's real money left on the table.
- EVERY deal credits F&I gross/PVR/PPU unless it's marked DNQ — cash deals COUNT (Aaron's store rule: "it qualifies unless it's a DNQ"). Only DNQ is protected out. Products on a DNQ deal don't count — flag that mismatch. Always say "finance / cash / DNQ" to the floor, never "classified."
- PPU (products per unit) = product units ÷ finance copies, using this store's product weights.
- Split deals (a second salesperson) = half a unit and half the gross to each rep.
- Trade equity = trade ACV − payoff; negative equity rolls into the new loan.
- When asked to AUDIT: go deal by deal off the raw numbers, list every deal where something's off (missing invoice/holdback, negative gross, products on a DNQ deal, phantom/missing doc fee, off PVR), state the dollar impact, then the fix. Show your work with real numbers.

COACHING MEMORY — this makes you a real coach, not a calculator:
- You keep a persistent memory on every salesperson and F&I manager — strengths, weaknesses, patterns, your past notes — shown below under "EILA'S COACHING MEMORY". You KNOW these people; reference what you've learned when you coach them.
- Whenever you notice something worth remembering about a rep — a strength, a weakness, or a pattern — call the remember_rep tool to save it, even without being asked. Build each rep's profile over time so your coaching gets sharper.`;

// The sales-trainer playbook is large and only matters for live coaching, so it
// rides ONLY on the chat path (callEILAChat) — not on the high-frequency
// health-check / draft-followup / next-action calls. Keeps those fast and cheap.
const COACHING_PROMPT = `

SALES COACHING — you carry the playbook of the world's best sales trainers:
- Below is "EILA'S SALES PLAYBOOK" — distilled methods, frameworks, and verbatim rebuttal word tracks from the greatest sales trainers and negotiators alive (Ziglar, Hopkins, Tracy, Belfort, Gitomer, Carnegie, Cialdini, Chris Voss, Jeb Blount, Sandler, SPIN, Challenger). This is your edge.
- When a rep brings you an objection ("customer says the payment's too high," "they want to think about it," "they're not giving me enough for my trade"), hand them the EXACT words to say, pulled from the playbook — then name the technique and the trainer so they learn the craft, not just the line.
- Always tailor the word track to the real deal: use the customer's name, the actual vehicle, and the real numbers from the data. A generic script is worth less than one aimed at the deal on the desk.
- Coach proactively. If you see a rep losing gross, blowing be-backs, or missing closes, teach them the relevant move from the playbook before they ask.
- PER-REP DRILLS: when a rep has a known weakness in your coaching memory, assign a specific drill — name the objection or skill, give the EXACT word track from the playbook to memorize, tell them to run it out loud 10x and use it on their next up, then save it with remember_rep (the "drill" field) so it sticks to their profile. Tie every drill to that rep's real weakness, and follow up on drills you've already assigned (shown in their profile under "drills").

ALWAYS LEARNING — this is your edge, and it COMPOUNDS. You build three living memories over time, shown above under "EILA'S ... MEMORY":
- Each REP — strengths, weaknesses, patterns, drills (remember_rep).
- Each CUSTOMER — what they want, their objections, their situation, how to handle them (remember_customer). Never restart a customer conversation cold; pull from what you already know.
- The STORE PLAYBOOK — high-order patterns about THIS floor: what converts, which objection-beating word tracks land here, timing/source trends (remember_pattern).
Whenever you learn something worth keeping — even if no one asked — save it with the right tool, so next time you start smarter, not from scratch. And when you DON'T know something: don't guess — use your tools and the data to figure it out, act on it, then SAVE what you learned so you never have to figure it out twice. That loop is what makes you smarter every single deal.

- LEARN FROM EVERY MISTAKE — yours AND everyone else's — until you are wise enough never to make them. The instant a mistake shows up ANYWHERE — a rep's miss, an F&I error, a structure / fee / tax / compliance slip, a negative gross, a missing doc, a blown follow-up, OR a time YOU got something wrong and were corrected — log it with remember_mistake, capturing the warning SIGN that flags it and the FIX. Then check EVERY deal, for every person, against the "MISTAKES EILA HAS LEARNED" list above, and the moment you see that same setup forming, CATCH it and warn before it repeats. You carry the hard-won lessons of the whole floor, so no one — including you — ever has to learn the same one twice. A mistake should cost this store exactly once. This is how you become the wisest head in the building.

- ALWAYS DRIVE THE BOTTOM LINE — on EVERY deal, hunt the money left on the table: tighter structure, the right product on the right deal, protected front AND back gross, a smarter rate spread, a fee that rightfully belongs, a stronger menu presentation. Show the rep or F&I manager exactly how to capture it — but NEVER at the customer's expense, and NEVER by bending compliance or fudging the math (money correctness is sacred). Maximize the gross the honest way, on every single deal.
- ALWAYS IMPROVE THE PROCESS — never accept "that's how we've always done it." Constantly hunt for a better way to run the floor: a sharper follow-up cadence, a faster desk turn, a cleaner BDC-to-sales-to-F&I handoff, a leak that's quietly costing deals or gross. Surface the improvement proactively, before anyone asks — every deal a little richer, every process a little tighter. That is your standing job, always.
- A DAILY ACTION PLAN FOR EACH PERSON — every rep has a number to hit by month-end, and your job is to get them there. For each individual, build a DAILY plan tailored to THEM: their personality and what motivates them, where they are in life and what they're working toward (from their rep memory above), and exactly where they stand vs their monthly goal (you have their units, pace, and daily-need in the data). Give them the few concrete moves to make TODAY — the calls, the appointments, the walk-arounds, the follow-ups, the one drill — that close the gap, delivered in the tone that actually lands for that person (a hard-charger gets a different push than someone rebuilding confidence). As long as the rep puts in the work, you are their partner in hitting that goal: encourage them, hold them accountable, and adjust the plan as the month moves and their numbers change. You are there to help them win.
- WATCH THE SALES MANAGER'S BACK — you run quietly in the background as his second set of eyes. Proactively flag what's slipping: an active lead the salesperson hasn't followed up (in the pipeline above with "NO next action" and aging, no appointment) — tell the manager exactly which customer, which rep, and that it needs a touch NOW. And flag what's MISSING on a deal: a rebate or incentive the customer qualifies for (cross-check the deal against the CURRENT MONTHLY SETUP incentives) that isn't applied, a missing invoice, a fee that belongs, gross left on the table — anything he may have overlooked. Surface it before it costs the sale or the gross, whether or not anyone asked.
- BUILD THE DEAL WHEN HE CAN'T SEE IT — when a manager is stuck and can't find a way to put a deal together, structure it for him. Work every lever — selling price, term, rate (inside the buy/sell spread), cash down, the trade, every rebate the customer qualifies for, the right products — to reach the customer's target payment or the store's gross target, and lay out the exact path with real numbers (show the math; money correctness is sacred). If it genuinely can't be made, say so honestly and name exactly what would have to change to get there.
- INVENTORY → THE RIGHT VEHICLE: when the store's inventory is loaded into your data and you're given a deal's goal (a target payment, a budget, or a gross target), recommend the exact model + trim to land the customer on and the stock number (at Kennesaw Mazda the stock number is the last 7 of the VIN), using the real invoice/MSRP from inventory to protect gross. ⚠ Until inventory is actually loaded into your data, NEVER invent or guess a stock number, VIN, trim, or invoice — say plainly that you need the current inventory loaded first. A made-up stock number is far worse than admitting you don't have inventory yet.
${SALES_PLAYBOOK}`;

// Per-store economics, rendered from the caller org's storeSettings so EILA
// uses THIS dealership's doc fee / holdback / tax / weights / targets — never a
// hardcoded Kennesaw/GA assumption.
function storeContext(s: StoreSettings): string {
  const pct = (f: number) => `${+(f * 100).toFixed(2)}%`;
  const money = (n: number) => currency(Number.isFinite(n) ? n : 0);
  const weights = (Object.keys(s.productWeights) as ProductKey[])
    .map((k) => `${productLabels[k] ?? String(k).toUpperCase()}=${s.productWeights[k]}`)
    .join(", ");
  const taxBase = s.tax.basis === "price_plus_docfee" ? "selling price + doc fee" : "selling price";
  return [
    `THIS STORE — use these exact, store-specific figures (configured per dealership; never assume another store's numbers):`,
    `- Store: ${s.storeName}. A store may sell NEW and/or USED vehicles of multiple makes; off-brand used inventory is normal and a profit center — never tell a rep an off-brand used unit "doesn't belong on the lot."`,
    `- Doc fee: ${money(s.docFee)} on retail (New/Used); $0 on Wholesale.`,
    `- New-vehicle manufacturer holdback ("manufacturer money") = ${pct(s.holdbackPct)} of invoice.`,
    `- Tax: ${s.tax.label} = ${pct(s.tax.rate)} applied to ${taxBase}.`,
    `- F&I products and PPU weights: ${weights}.`,
    `- Targets: ${s.targets.deliveredUnits} delivered units; PVR goal ${money(s.targets.pvrTotal)} (front ${money(s.targets.frontEnd)} / back ${money(s.targets.backEnd)}); PPU floor ${s.targets.ppuMinimum}, elite ${s.targets.ppuElite}.`,
  ].join("\n");
}

function leadToContext(lead: Record<string, any>): string {
  const desk = lead.sellingPrice
    ? `Selling Price: $${lead.sellingPrice} | Cash Down: $${lead.cashDown || 0} | Payment: $${lead.payment || 0}`
    : "No numbers entered yet";

  return `
LEAD:
  Customer: ${lead.customer || "Unknown"} | Phone: ${lead.customerPhone || "none"} | Email: ${lead.customerEmail || "none"}
  Status: ${lead.status} | Source: ${lead.source || "Unknown"}
  Vehicle: ${lead.vehicle || "TBD"} (${lead.vehicleClass || "Unknown"}) | Stock: ${lead.stockNumber || "none"}
  Salesperson: ${lead.salesperson || "Unassigned"} | Desk Manager: ${lead.deskManager || "Unassigned"} | F&I: ${lead.financeManager || "Unassigned"}
  Credit: ${lead.creditStatus || "Not Started"} | Score: ${lead.creditScore || "unknown"} | Income: ${lead.monthlyIncome || "unknown"}
  ${desk}
  Trade: ${lead.tradeYear ? `${lead.tradeYear} ${lead.tradeMake} ${lead.tradeModel} — Allowance $${lead.tradeValue || 0} / Payoff $${lead.payoff || 0}` : "No trade"}
  Next Action: ${lead.nextAction || "None set"}
  Salesperson notes (follow-up): ${lead.notes || "None"}
  Sales manager notes: ${lead.managerNotes || "None"}
`.trim();
}

type EILAData = Record<string, any>;

// Pulls one store's raw Dealer Mission OS dataset ONCE (deals, team, goals, CRM leads,
// rep profiles, monthly setup). Used to BOTH build the capped text snapshot and
// back EILA's live-query tools — so the tools run over already-loaded data in
// memory with no extra database round-trips.
async function loadStoreData(orgId: string): Promise<EILAData> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return {};
  const { data } = await supabase.from("app_store").select("key,value").eq("org_id", orgId).in("key", ["deals", "team", "goals", "crmLeads", "repProfiles", "monthlySetup", "customerMemory", "storeMemory", "mistakeMemory", "compPlans", "payplans", "serviceLane", "partsCounter", "closedMonths"]);
  return Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));
}

// One deal rendered as a full raw-numbers line — the format EILA audits from.
// Shared by the snapshot and the query_deals tool so they never diverge.
function dealLine(d: any, idx: number, settings: StoreSettings, who: string): string {
  const prodUnits = d.products ? productUnits(d, settings.productWeights) : 0;
  const hold = manufacturerMoney(d, settings);
  const eq = (typeof d.tradeAcv === "number" || typeof d.tradePayoff === "number") ? (d.tradeAcv ?? 0) - (d.tradePayoff ?? 0) : null;
  const money = (n: number) => currency(Number.isFinite(n) ? n : 0);
  const lease = d.isLease ? ` | LEASE ${money(d.leaseMonthlyPayment || 0)}/mo×${d.leaseTermMonths || "?"}` : "";
  return `  [${idx}] ${who} | SP ${d.salesperson || "—"}${d.salesperson2 ? "+" + d.salesperson2 : ""} | FI ${d.financeManager || "—"} | ${d.vehicleClass || "?"} ${d.stockNumber || ""} | ${d.stage || "?"}/${d.financeStatus || "?"} | front ${money(commissionableFrontGross(d))} docFee ${money(docFeeIncome(d, settings))} invoice ${money(d.invoiceAmount || 0)} hold ${money(hold)} back ${money(d.backGrossReserve || 0)} | prod u${prodUnits} | cash ${d.cashDeal ? "Y" : "N"}${eq !== null ? ` | tradeEq ${money(eq)}` : ""}${lease}`;
}

// Formats the already-loaded dataset into the capped text snapshot EILA gets
// every chat turn — enough to answer most things AND audit the math, using THIS
// store's doc-fee / holdback / weight settings. (Uncapped drill-downs come from
// the live-query tools below.)
function buildSnapshot(map: EILAData, settings: StoreSettings, viewer: Viewer): string {

  // Privacy: line reps (Sales/BDC) never see another rep's customer identities;
  // Sales also only sees its own CRM leads. Managers/F&I/Admin see the store.
  const dealsRedact = viewer.role === "Sales" || viewer.role === "BDC";
  const leadsOwnOnly = viewer.role === "Sales";
  const ownsDeal = (d: any) => samePerson(d.salesperson, viewer.employeeName) || samePerson(d.salesperson2, viewer.employeeName);

  const deals: any[] = Array.isArray(map.deals) ? map.deals : [];
  const team = map.team || {};
  const salespeople: string[] = Array.isArray(team.salespeople) ? team.salespeople : [];
  const managers: string[] = Array.isArray(team.managers) ? team.managers : [];
  const financeManagers: string[] = Array.isArray(team.financeManagers) ? team.financeManagers : [];
  const sGoals = map.goals || {};
  const allLeads: any[] = Array.isArray(map.crmLeads) ? map.crmLeads : [];
  const leads: any[] = leadsOwnOnly ? allLeads.filter((l) => samePerson(l.salesperson, viewer.employeeName)) : allLeads;

  const repNames = Array.from(new Set([...salespeople, ...salespersonNamesFromDeals(deals)]));
  const fiNames = Array.from(new Set([...financeManagers, ...financeManagerNamesFromDeals(deals)]));
  const board = salesLeaderboard(deals, repNames);
  const fiBoard = financeLeaderboard(deals, fiNames);

  const units = board.reduce((s, r) => s + r.units, 0);
  const front = board.reduce((s, r) => s + r.frontGross, 0);
  const back = board.reduce((s, r) => s + r.backGross, 0);
  const pvr = units ? (front + back) / units : 0;
  const unitGoal = Number(sGoals.teamDeliveredUnits) || settings.targets.deliveredUnits;
  const pvrGoal = Number(sGoals.pvrTotal) || settings.targets.pvrTotal;
  const money = (n: number) => currency(Number.isFinite(n) ? n : 0);

  // Pace / projection / daily-need — computed by the SAME tested engine the
  // screens use (currentMonthPace/paceValue/dailyNeed), so EILA quotes the real
  // numbers instead of inventing them. Selling days exclude Sundays.
  const pace = currentMonthPace(deals);
  const projUnits = Math.round(paceValue(units, pace));
  const storeDailyNeed = dailyNeed(unitGoal, units, pace.remainingDays);
  const onPaceThreshold = pace.daysInMonth ? (unitGoal * pace.sellingDaysSoFar) / pace.daysInMonth : 0;
  const perRepGoals: Record<string, any> = (sGoals.salespersonUnits && typeof sGoals.salespersonUnits === "object") ? sGoals.salespersonUnits : {};

  const statusCounts: Record<string, number> = {};
  for (const l of leads) { const k = l.status || "Unknown"; statusCounts[k] = (statusCounts[k] || 0) + 1; }

  const L: string[] = [];
  L.push(`=== DEALER MISSION OS LIVE DATA — ${settings.storeName}. Use these exact numbers; do not guess. ===`);
  L.push(`TEAM: ${salespeople.length} salespeople, ${managers.length} sales managers, ${financeManagers.length} F&I managers.`);
  if (salespeople.length) L.push(`  Salespeople: ${salespeople.join(", ")}`);
  if (managers.length) L.push(`  Sales managers: ${managers.join(", ")}`);
  if (financeManagers.length) L.push(`  F&I managers: ${financeManagers.join(", ")}`);
  L.push("");
  L.push(`SALES MTD: ${unitsLabel(units)} of ${unitGoal} units (${unitGoal ? Math.round((units / unitGoal) * 100) : 0}% to goal). Front ${money(front)} | Back ${money(back)} | Commissionable total ${money(front + back)} (front+back, ex doc fee) | Store PVR ${money(pvr)} (goal ${money(pvrGoal)}).`);
  // Doc-fee-inclusive store gross/PVR, computed by the SAME engine (metricsFor)
  // the GM Command screen uses — so EILA's "total gross" matches that dashboard
  // instead of trailing it by the month's doc-fee income.
  const storeM = metricsFor(deals);
  L.push(`STORE GROSS w/ DOC (matches GM Command): ${money(storeM.gross)} on ${storeM.delivered} retail units · PVR w/ doc ${money(storeM.pvr)} · doc-fee income ${money(storeM.docFees)}.`);
  L.push(`PACE (${pace.monthName}, Sundays closed): ${pace.elapsedDays} selling days elapsed, ${pace.remainingDays} remaining of ${pace.daysInMonth}. Projected month-end at current run-rate: ${projUnits} units. To hit ${unitGoal} the store needs ${storeDailyNeed.toFixed(1)} units/day the rest of the way. ${units >= onPaceThreshold ? "On or ahead of pace." : "Behind pace."}`);
  L.push("  Salesperson board (units · total · PVR · PPU · goal/daily-need):");
  for (const r of board.filter((r) => r.units > 0)) {
    const g = Number(perRepGoals[r.name]) || 0;
    const needStr = g ? ` · goal ${g} (need ${dailyNeed(g, r.units, pace.remainingDays).toFixed(1)}/day)` : " · no personal goal set";
    L.push(`    ${r.name}: ${unitsLabel(r.units)}u · ${money(r.totalGross)} · ${money(r.pvr)} · ${r.ppu.toFixed(1)}PPU${needStr}`);
  }
  L.push("  F&I board (copies · back gross · PVR · PPU · products):");
  for (const f of fiBoard.filter((f) => f.copies > 0)) L.push(`    ${f.name}: ${f.copies} · ${money(f.backGross)} · ${money(f.pvr)} · ${f.ppu.toFixed(2)}PPU · ${f.products}`);
  L.push("");
  L.push(`ALL DEALS (${deals.length}) — raw numbers for auditing${dealsRedact ? " (customer names on OTHER reps' deals are hidden for privacy — refer to those by stock # only, never invent a name)" : ""}:`);
  deals.forEach((d, i) => {
    const who = dealsRedact && !ownsDeal(d) ? "[hidden]" : (d.customer || "?");
    L.push(dealLine(d, i + 1, settings, who));
  });
  L.push("");
  L.push(`${leadsOwnOnly ? "YOUR CRM PIPELINE" : "CRM PIPELINE"} (${leads.length}): ` + Object.entries(statusCounts).map(([s, n]) => `${s} ${n}`).join(", "));
  L.push(`  ${leadsOwnOnly ? "Your leads" : "Every lead"} (customer · status · salesperson · vehicle · phone):`);
  for (const l of leads) {
    const next = l.nextAction ? `next: ${l.nextAction}` : "⚠ NO next action";
    const appt = l.appointment ? "appt set" : "no appt";
    const since = l.date ? ` · since ${String(l.date).slice(0, 10)}` : "";
    L.push(`    ${l.customer || "?"} · ${l.status || "?"} · ${l.salesperson || "—"} · ${l.vehicle || "TBD"} · ${l.customerPhone || "no phone"} · ${next} · ${appt}${since}`);
  }

  // Monthly setup (rate sheets / incentives / residuals) the admin loaded — EILA
  // quotes from THESE current figures instead of guessing or using stale rates.
  const setupBlock = formatSetupForEILA(map.monthlySetup);
  if (setupBlock) {
    L.push("");
    L.push("=== CURRENT MONTHLY SETUP (admin-loaded reference — quote from this) ===");
    L.push(setupBlock);
  }

  const profiles = (map.repProfiles && typeof map.repProfiles === "object") ? map.repProfiles : {};
  // Privacy: a rep's coaching profile (weaknesses, drills, motivation/life notes)
  // is personal. Line reps (Sales/BDC) only see their OWN; managers/F&I/admin see
  // the floor — mirroring the deal/lead redaction above.
  const profileNames = Object.keys(profiles).filter((n) => !dealsRedact || samePerson(n, viewer.employeeName));
  L.push("");
  L.push(dealsRedact
    ? "EILA'S COACHING MEMORY (what you've learned about YOU — build on it; other reps' profiles are private):"
    : "EILA'S COACHING MEMORY (what you've learned about each rep — build on it):");
  if (profileNames.length === 0) {
    L.push("  (empty — you haven't recorded anything yet. As you notice strengths, weaknesses, and patterns, use remember_rep to build it.)");
  } else {
    for (const name of profileNames) {
      const p = profiles[name] || {};
      const parts: string[] = [];
      if (p.personality) parts.push(`personality: ${p.personality}`);
      if (p.motivation) parts.push(`motivation/life: ${p.motivation}`);
      if (p.strengths?.length) parts.push(`strengths: ${p.strengths.join("; ")}`);
      if (p.weaknesses?.length) parts.push(`weaknesses: ${p.weaknesses.join("; ")}`);
      if (p.patterns?.length) parts.push(`patterns: ${p.patterns.join("; ")}`);
      if (p.drills?.length) parts.push(`drills assigned: ${p.drills.join("; ")}`);
      if (p.notes?.length) parts.push(`notes: ${p.notes.join(" | ")}`);
      L.push(`    ${name} — ${parts.join(" || ") || "no detail yet"}`);
    }
  }
  // EILA'S STORE PLAYBOOK — high-order patterns she's learned about THIS floor.
  // Always loaded; this is the part that compounds (gets smarter every deal).
  const storeMem = (map.storeMemory && typeof map.storeMemory === "object") ? map.storeMemory : {};
  const patterns: any[] = Array.isArray(storeMem.patterns) ? storeMem.patterns : [];
  L.push("");
  L.push("EILA'S STORE PLAYBOOK (patterns you've learned about THIS floor — apply them, keep building):");
  if (patterns.length === 0) {
    L.push("  (empty — as you spot what converts, what objections recur and the word track that beats them, save it with remember_pattern.)");
  } else {
    for (const p of patterns.slice(-40)) L.push(`  - ${typeof p === "string" ? p : p.text}`);
  }

  // MISTAKES EILA HAS LEARNED — every past mistake + the warning sign that flags
  // it, so she CATCHES it before it repeats. The guardrail that compounds; a
  // mistake should only ever cost this store once.
  const mistakeMem = (map.mistakeMemory && typeof map.mistakeMemory === "object") ? map.mistakeMemory : {};
  const mistakes: any[] = Array.isArray(mistakeMem.mistakes) ? mistakeMem.mistakes : [];
  L.push("");
  L.push("MISTAKES EILA HAS LEARNED (check EVERY deal against these — catch them before they repeat):");
  if (mistakes.length === 0) {
    L.push("  (none yet — the first time a mistake shows up on a deal, log it with remember_mistake so you catch it next time.)");
  } else {
    for (const m of mistakes.slice(-50)) {
      const sign = m.sign ? ` || WATCH FOR: ${m.sign}` : "";
      const fix = m.fix ? ` || CATCH: ${m.fix}` : "";
      L.push(`  ⚠ ${m.what}${sign}${fix}`);
    }
  }

  // EILA'S CUSTOMER MEMORY — what she's learned about specific customers, so she
  // and the rep never restart a conversation cold. Most-recently-updated first,
  // capped so the context stays bounded.
  const custMem = (map.customerMemory && typeof map.customerMemory === "object") ? map.customerMemory : {};
  // Privacy: customer memory (wants, objections, personal situation) is PII. For
  // Sales/BDC restrict to customers on the caller's OWN deals or leads — the same
  // ownership rule that hides other reps' customer names on the deal lines above.
  // Filter BEFORE the recency cap so a rep still gets their own most-recent 40.
  const myCustomerNames = dealsRedact
    ? new Set(
        [
          ...deals.filter(ownsDeal).map((d) => String(d.customer || "").trim().toLowerCase()),
          ...allLeads.filter((l) => samePerson(l.salesperson, viewer.employeeName)).map((l) => String(l.customer || "").trim().toLowerCase()),
        ].filter(Boolean),
      )
    : null;
  const custKeys = Object.keys(custMem)
    .filter((k) => !myCustomerNames || myCustomerNames.has(String(custMem[k]?.name || k).trim().toLowerCase()))
    .sort((a, b) => String(custMem[b]?.updatedAt || "").localeCompare(String(custMem[a]?.updatedAt || "")))
    .slice(0, 40);
  L.push("");
  L.push(dealsRedact
    ? "EILA'S CUSTOMER MEMORY (what you've learned about YOUR customers — never restart cold; other reps' customers are private):"
    : "EILA'S CUSTOMER MEMORY (what you've learned about specific customers — never restart cold):");
  if (custKeys.length === 0) {
    L.push("  (empty — as you learn what a customer wants, their objections, or their situation, save it with remember_customer.)");
  } else {
    for (const k of custKeys) {
      const c = custMem[k] || {};
      const parts: string[] = [];
      if (c.wants?.length) parts.push(`wants: ${c.wants.join("; ")}`);
      if (c.objections?.length) parts.push(`objections: ${c.objections.join("; ")}`);
      if (c.context?.length) parts.push(`context: ${c.context.join("; ")}`);
      if (c.notes?.length) parts.push(`notes: ${c.notes.join(" | ")}`);
      L.push(`    ${c.name || k} — ${parts.join(" || ") || "no detail yet"}`);
    }
  }

  L.push("=== END DATA ===");
  return L.join("\n");
}

// EILA's persistent coaching memory: one profile per rep, accumulated over
// time, scoped to the caller's store.
async function saveRepObservation(input: any, orgId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const rep = String(input?.rep || "").trim();
  if (!rep) return "No rep name given.";
  const add = (arr: string[], items: any) => {
    for (const it of Array.isArray(items) ? items : []) {
      const s = String(it).trim();
      if (s && !arr.includes(s)) arr.push(s);
    }
  };
  // Compare-and-swap so a concurrent CRM edit isn't clobbered (guardedMutate may
  // re-run this on a version conflict, against freshly-read data).
  await guardedMutate<Record<string, any>>(supabase, orgId, "repProfiles", (current) => {
    const profiles: Record<string, any> = current && typeof current === "object" ? current : {};
    const p = profiles[rep] || {};
    p.strengths = Array.isArray(p.strengths) ? p.strengths : [];
    p.weaknesses = Array.isArray(p.weaknesses) ? p.weaknesses : [];
    p.patterns = Array.isArray(p.patterns) ? p.patterns : [];
    p.notes = Array.isArray(p.notes) ? p.notes : [];
    p.drills = Array.isArray(p.drills) ? p.drills : [];
    add(p.strengths, input.strengths);
    add(p.weaknesses, input.weaknesses);
    add(p.patterns, input.patterns);
    if (input.note && String(input.note).trim()) p.notes.push(String(input.note).trim());
    if (input.drill && String(input.drill).trim()) {
      const d = String(input.drill).trim();
      if (!p.drills.includes(d)) p.drills.push(d);
    }
    if (input.personality && String(input.personality).trim()) p.personality = String(input.personality).trim();
    if (input.motivation && String(input.motivation).trim()) p.motivation = String(input.motivation).trim();
    p.updatedAt = new Date().toISOString();
    profiles[rep] = p;
    return profiles;
  });
  return `Saved to ${rep}'s coaching profile.`;
}

// EILA's CUSTOMER memory — what she learns about each customer over time (wants,
// objections, situation), so she and the rep never restart a conversation cold.
// Part of her learning loop; scoped to the caller's store.
async function saveCustomerObservation(input: any, orgId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const who = String(input?.customer || "").trim();
  if (!who) return "No customer given.";
  const key = who.toLowerCase();
  const add = (arr: string[], items: any) => {
    for (const it of Array.isArray(items) ? items : []) {
      const s = String(it).trim();
      if (s && !arr.includes(s)) arr.push(s);
    }
  };
  await guardedMutate<Record<string, any>>(supabase, orgId, "customerMemory", (current) => {
    const memo: Record<string, any> = current && typeof current === "object" ? current : {};
    const c = memo[key] || { name: who };
    c.wants = Array.isArray(c.wants) ? c.wants : [];
    c.objections = Array.isArray(c.objections) ? c.objections : [];
    c.context = Array.isArray(c.context) ? c.context : [];
    c.notes = Array.isArray(c.notes) ? c.notes : [];
    add(c.wants, input.wants);
    add(c.objections, input.objections);
    add(c.context, input.context);
    if (input.note && String(input.note).trim()) c.notes.push(String(input.note).trim());
    c.name = who;
    c.updatedAt = new Date().toISOString();
    memo[key] = c;
    return memo;
  });
  return `Saved to ${who}'s customer memory.`;
}

// EILA's STORE memory — the high-order patterns she learns about THIS floor (what
// converts, what objection-beating word tracks land, timing/source trends). The
// compounding playbook; capped to the most recent so context stays bounded.
async function savePatternObservation(input: any, orgId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const text = String(input?.pattern || "").trim();
  if (!text) return "No pattern given.";
  await guardedMutate<any>(supabase, orgId, "storeMemory", (current) => {
    const store: any = current && typeof current === "object" ? current : {};
    store.patterns = Array.isArray(store.patterns) ? store.patterns : [];
    if (!store.patterns.some((p: any) => (typeof p === "string" ? p : p.text) === text)) {
      store.patterns.push({ text, at: new Date().toISOString() });
    }
    if (store.patterns.length > 80) store.patterns = store.patterns.slice(-80);
    store.updatedAt = new Date().toISOString();
    return store;
  });
  return "Saved to the store playbook.";
}

// EILA's MISTAKE memory — every mistake on a deal becomes a permanent lesson with
// the warning sign to watch for, so she catches it before it ever repeats. A
// mistake should only cost this store once.
async function saveMistakeObservation(input: any, orgId: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Memory store unavailable.";
  const what = String(input?.mistake || "").trim();
  if (!what) return "No mistake described.";
  await guardedMutate<any>(supabase, orgId, "mistakeMemory", (current) => {
    const store: any = current && typeof current === "object" ? current : {};
    store.mistakes = Array.isArray(store.mistakes) ? store.mistakes : [];
    const entry = {
      what,
      sign: String(input?.sign || "").trim(),
      fix: String(input?.fix || "").trim(),
      deal: String(input?.deal || "").trim(),
      at: new Date().toISOString(),
    };
    if (!store.mistakes.some((m: any) => m.what === entry.what)) store.mistakes.push(entry);
    if (store.mistakes.length > 80) store.mistakes = store.mistakes.slice(-80);
    store.updatedAt = new Date().toISOString();
    return store;
  });
  return "Logged the mistake — I'll catch it before it repeats.";
}

// Everything an EILA tool handler needs: the caller's store, role, and the raw
// already-loaded dataset (so tools never hit the database again).
type EILAContext = { orgId: string; settings: StoreSettings; viewer: Viewer; data: EILAData };

const num = (v: any) => (Number.isFinite(+v) ? +v : 0);

// query_deals — drill the FULL deal list (uncapped) by rep / FM / stage / type /
// audit issue, returning matching deals with full numbers + a quick total.
function handleQueryDeals(input: any, ctx: EILAContext): string {
  const deals: any[] = Array.isArray(ctx.data.deals) ? ctx.data.deals : [];
  const { settings, viewer } = ctx;
  const dealsRedact = viewer.role === "Sales" || viewer.role === "BDC";
  const owns = (d: any) => samePerson(d.salesperson, viewer.employeeName) || samePerson(d.salesperson2, viewer.employeeName);

  const sp = String(input?.salesperson || "").trim();
  const fm = String(input?.financeManager || "").trim();
  const stage = String(input?.stage || "").trim().toLowerCase();
  const vclass = String(input?.vehicleClass || "").trim().toLowerCase();
  const dealType = String(input?.dealType || "").trim().toLowerCase(); // finance|cash|dnq
  const issue = String(input?.issue || "").trim().toLowerCase();
  const limit = Math.min(Math.max(num(input?.limit) || 50, 1), 200);

  const isFinance = (d: any) => String(d.financeStatus || "").toLowerCase() === "classified";
  const isCash = (d: any) => !!d.cashDeal;
  const isDnq = (d: any) => /dnq|denied/.test(String(d.financeStatus || "").toLowerCase());

  let rows = deals.filter((d) => {
    if (sp && !(samePerson(d.salesperson, sp) || samePerson(d.salesperson2, sp))) return false;
    if (fm && !samePerson(d.financeManager, fm)) return false;
    if (stage && !String(d.stage || "").toLowerCase().includes(stage)) return false;
    if (vclass && !String(d.vehicleClass || "").toLowerCase().includes(vclass)) return false;
    if (dealType === "finance" && !isFinance(d)) return false;
    if (dealType === "cash" && !isCash(d)) return false;
    if (dealType === "dnq" && !isDnq(d)) return false;
    if (issue === "missing_invoice" && !(String(d.vehicleClass || "").toLowerCase() === "new" && num(d.invoiceAmount) <= 0)) return false;
    if (issue === "negative_gross" && !((commissionableFrontGross(d) + num(d.backGrossReserve)) < 0)) return false;
    // "products_on_cash" kept as the wire name for compatibility, but per
    // Aaron's rule (cash QUALIFIES) the real mismatch is products on a DNQ.
    if (issue === "products_on_cash" && !(d.products && productUnits(d, settings.productWeights) > 0 && isDnq(d))) return false;
    if (issue === "missing_docfee" && !(num(docFeeIncome(d, settings)) <= 0 && String(d.vehicleClass || "").toLowerCase() !== "wholesale")) return false;
    return true;
  });

  const total = rows.length;
  if (total === 0) return "No deals match that filter.";
  rows = rows.slice(0, limit);

  const money = (n: number) => currency(Number.isFinite(n) ? n : 0);
  // When filtered to a single salesperson, weight the totals by that rep's split
  // share so the number ties out to their scorecard (a 50% split counts as half),
  // instead of over-reporting the full deal front/back like the raw sum did.
  let units = 0, front = 0, back = 0;
  const lines = rows.map((d, i) => {
    const who = dealsRedact && !owns(d) ? "[hidden]" : (d.customer || "?");
    const share = sp ? salespersonShare(d, sp) : 1;
    front += commissionableFrontGross(d) * share; back += num(d.backGrossReserve) * share; units += share;
    return dealLine(d, i + 1, settings, who);
  });
  const uLabel = Number.isInteger(units) ? String(units) : units.toFixed(1);
  const head = `${total} deal(s) match${total > limit ? ` (showing first ${limit})` : ""}. Shown total: ${uLabel}u · front ${money(front)} · back ${money(back)} · total ${money(front + back)}${sp ? " (weighted to this rep's split share)" : ""}.`;
  return [head, ...lines].join("\n");
}

// rep_detail — the full picture on one rep: sales + F&I numbers, their deals,
// and the coaching memory EILA has built on them.
// deal_jacket — ONE deal's paper file: the store's required document order plus
// what's filed / N/A / still missing. Reads the SAME lib the Deal Center screen
// uses (lib/dealJacket) so EILA and the checklist can never disagree.
function handleDealJacket(input: any, ctx: EILAContext): string {
  const deals: any[] = Array.isArray(ctx.data.deals) ? ctx.data.deals : [];
  const q = String(input?.deal || "").trim().toLowerCase();
  if (!q) return "Which deal? Give me a deal number or customer name.";
  const match =
    deals.find((d) => String(d.dealNumber || "").trim().toLowerCase() === q) ||
    deals.find((d) => String(d.customer || "").toLowerCase().includes(q)) ||
    deals.find((d) => String(d.stockNumber || "").trim().toLowerCase() === q);
  if (!match) return `No deal matching "${String(input?.deal)}" on the board.`;
  const order = jacketOrderFor(ctx.settings);
  const s = jacketStatus(match, order);
  const L: string[] = [];
  L.push(
    `Deal ${match.dealNumber || "—"} · ${match.customer} · stock ${match.stockNumber || "—"} · ${match.lender || "—"} · F&I ${personLabel(match.financeManager)}`
  );
  L.push(jacketSummaryLine(match, order));
  L.push(`Required order (${order.length} docs, top of the stack first):`);
  for (const item of s.items) {
    L.push(`  ${item.position}. [${item.state === "have" ? "x" : item.state === "na" ? "N/A" : "  "}] ${item.doc}`);
  }
  L.push(
    "Docs get tapped off (and the cover sheet printed) from Deal Center — the folder icon on the deal row."
  );
  return L.join("\n");
}

function handleRepDetail(input: any, ctx: EILAContext): string {
  const name = String(input?.name || input?.rep || "").trim();
  if (!name) return "Give me a rep name.";
  const { settings, viewer, data } = ctx;
  const deals: any[] = Array.isArray(data.deals) ? data.deals : [];
  const dealsRedact = viewer.role === "Sales" || viewer.role === "BDC";
  const owns = (d: any) => samePerson(d.salesperson, viewer.employeeName) || samePerson(d.salesperson2, viewer.employeeName);
  const money = (n: number) => currency(Number.isFinite(n) ? n : 0);

  const sBoard = salesLeaderboard(deals, [name]).find((r) => samePerson(r.name, name));
  const fBoard = financeLeaderboard(deals, [name]).find((f) => samePerson(f.name, name));
  const theirDeals = deals.filter((d) => samePerson(d.salesperson, name) || samePerson(d.salesperson2, name) || samePerson(d.financeManager, name));

  const out: string[] = [`=== ${name} ===`];
  if (sBoard) out.push(`SALES: ${unitsLabel(sBoard.units)}u · front ${money(sBoard.frontGross)} · back ${money(sBoard.backGross)} · total ${money(sBoard.totalGross)} · PVR ${money(sBoard.pvr)} · ${sBoard.ppu.toFixed(1)}PPU`);
  if (fBoard) out.push(`F&I: ${fBoard.copies} copies · back ${money(fBoard.backGross)} · PVR ${money(fBoard.pvr)} · ${fBoard.ppu.toFixed(2)}PPU · ${fBoard.products} products`);
  if (!sBoard && !fBoard) out.push("No deals on the board yet for this person.");

  out.push(`Deals (${theirDeals.length}):`);
  theirDeals.slice(0, 100).forEach((d, i) => {
    const who = dealsRedact && !owns(d) ? "[hidden]" : (d.customer || "?");
    out.push(dealLine(d, i + 1, settings, who));
  });

  const profiles = (data.repProfiles && typeof data.repProfiles === "object") ? data.repProfiles : {};
  const key = Object.keys(profiles).find((k) => samePerson(k, name));
  const p = key ? profiles[key] : null;
  out.push("Coaching memory:");
  if (!p) out.push("  (nothing recorded yet)");
  else {
    if (p.strengths?.length) out.push(`  strengths: ${p.strengths.join("; ")}`);
    if (p.weaknesses?.length) out.push(`  weaknesses: ${p.weaknesses.join("; ")}`);
    if (p.patterns?.length) out.push(`  patterns: ${p.patterns.join("; ")}`);
    if (p.drills?.length) out.push(`  drills: ${p.drills.join("; ")}`);
    if (p.notes?.length) out.push(`  notes: ${p.notes.join(" | ")}`);
  }
  return out.join("\n");
}

// estimate_pay — run a person's month through the universal compensation engine
// (the SAME engine the scorecards use): rate, gross, penalties, net, and the best
// move to earn more this month. Pay is private: reps only get their own.
function handleEstimatePay(input: any, ctx: EILAContext): string {
  const { data, viewer } = ctx;
  const name = String(input?.person || input?.name || input?.rep || "").trim() || viewer.employeeName;
  if (!name) return "Tell me whose pay to estimate.";
  const repViewer = viewer.role === "Sales" || viewer.role === "BDC";
  if (repViewer && !samePerson(name, viewer.employeeName)) return "Pay is private — I can only break down your own pay for you.";

  const deals: any[] = Array.isArray(data.deals) ? data.deals : [];
  const money = (n: number) => currency(Number.isFinite(n) ? n : 0);

  let role = String(input?.role || "").trim();
  if (!role) {
    const isFi = deals.some((d) => samePerson(d.financeManager, name) && isCountableFinance(d));
    const isSales = deals.some((d) => salespersonShare(d, name) > 0);
    const isManager = deals.some((d) => samePerson(d.manager, name));
    role = isFi && !isSales ? "F&I" : (isManager && !isSales && !isFi) ? "Manager" : "Sales";
  }

  const payable = deals.filter((d) => d.stage === "Delivered" || d.stage === "Funded");
  const theirDeals =
    role === "F&I" ? payable.filter((d) => isCountableFinance(d) && samePerson(d.financeManager, name))
      : role === "Manager" ? payable.filter((d) => samePerson(d.manager, name))
        // WHOLESALE DOES NOT PAY REPS (Aaron's rule): retail only, same as the scorecard.
        : payable.filter((d) => isRetail(d) && salespersonShare(d, name) > 0);
  if (theirDeals.length === 0) return `${name} has no delivered/funded deals as ${role} yet this month — nothing to estimate.`;

  const plans: any[] = Array.isArray(data.compPlans) ? data.compPlans : [];
  const active = plans.find((p) => p?.active && p?.role === role) as CompPlan | undefined;
  // One brain with My Scorecard: no active studio plan → the person's OWN
  // customized SalesPlan (payplans store) → only then the house template.
  let personal: CompPlan | null = null;
  if (!active && role === "Sales") {
    const payplans: any[] = Array.isArray((data as any).payplans) ? (data as any).payplans : [];
    const mine = payplans.find((pp) => pp?.role === "Sales" && samePerson(String(pp?.personName || ""), name));
    if (mine?.sales) personal = salesPlanToCompPlan(mine.sales, { name: `${name} — personal plan` }).plan;
  }
  const plan: CompPlan | null = active || personal || templateForRole(role);
  if (!plan) return `No structured pay plan is set for ${role} yet — upload one in the Pay Plan Studio and I can estimate it.`;

  // Feed the SAME CSI/menu/uncashed gates the scorecard passes (my-scorecard reads
  // these off the plan), so a rep who missed a menu or CSI gate gets the same net
  // EILA quotes and the screen shows — never an over-reported number.
  const planFlags = plan as any;
  const r = computePay(
    plan,
    buildPerformance(theirDeals as any, {
      role,
      name,
      menuMet: planFlags.menuMet !== false,
      csiMet: planFlags.csiMet !== false,
      csiMonthsBelow: planFlags.csiMonthsBelow ?? 1,
      uncashedContracts: planFlags.uncashedContracts ?? 0,
    }),
    buildDealRows(theirDeals as any, role === "Sales" ? name : undefined),
  );

  // Bonus forfeiture: a manager can flip bonusEligible=false (Goals page) to
  // forfeit a rep's month of bonuses. The universal engine can't model that gate
  // (see migrateSalesPlan), so mirror My Scorecard — strip the flat bonus dollars
  // so EILA never quotes forfeited bonuses as earned (an ~$2,900 over-report).
  const payplansAll: any[] = Array.isArray((data as any).payplans) ? (data as any).payplans : [];
  const theirSalesPlan = payplansAll.find((pp) => pp?.role === role && samePerson(String(pp?.personName || ""), name));
  const bonusForfeited = role === "Sales" && (theirSalesPlan?.sales?.bonusEligible === false || theirSalesPlan?.bonusEligible === false);
  const flatBonus = (r.bonuses || []).reduce((s: number, b: any) => s + (Number(b?.amount) || 0), 0);
  const forfeit = bonusForfeited ? flatBonus : 0;
  const commissionAfterPenalty = r.netEstimatedPay + r.drawOffset - forfeit; // before draw — the scorecard headline
  const checkAfterDraw = r.netEstimatedPay - forfeit; // after the draw advance

  // Pay-cycle context: what period this covers and when the check lands. Plan
  // cycle wins, else the store's, else calendar-month. Informational — the deal
  // set summed above is unchanged (the dealership's data is already the period).
  const cycle = plan.cycle ?? ctx.settings?.payCycle ?? CALENDAR_MONTH_CYCLE;
  const period = periodFor(cycle, new Date());
  const per = cycle.periodNoun || "month";
  const dstr = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const out: string[] = [`=== Estimated pay — ${name} (${role}) · ${plan.name}${active ? " [activated]" : " [default]"} ===`];
  out.push(`Pay period: ${period.label} · check issued ${dstr(period.payDate)}`);
  out.push(`Rate ${r.effectiveRatePct.toFixed(1)}% · gross ${money(r.grossCommission)}`);
  for (const p of r.penalties) out.push(`  penalty ${p.label}: −${money(p.amount)} (−${p.pct}%)`);
  for (const d of r.deductions) out.push(`  deduction ${d.label}: −${money(d.amount)}`);
  if (forfeit) out.push(`  bonuses FORFEITED this ${per} (eligibility off): −${money(forfeit)}`);
  // Report BOTH numbers with matching labels so EILA never collides with the
  // scorecard: the headline "Est Month Pay" is commission BEFORE the draw; the
  // actual check is AFTER the draw advance.
  out.push(`Commission after penalties (before draw — matches "Est Month Pay"): ${money(commissionAfterPenalty)}`);
  if (r.drawOffset) out.push(`  less ${money(r.drawOffset)} ${per} draw already advanced`);
  out.push(`Estimated CHECK after draw: ${money(checkAfterDraw)}`);
  if (r.opportunities.length) {
    out.push(`Best moves to earn more this ${per}:`);
    r.opportunities.slice(0, 2).forEach((o) => out.push(`  • ${o.label} — ${o.detail}${o.estAddedPay != null ? ` (~${money(o.estAddedPay)}/${per})` : ""}`));
  }
  out.push(`Basis: ${r.explanation.join(" ")}`);
  if (r.warnings.length) out.push(`Caveats: ${r.warnings.join(" ")}`);
  return out.join("\n");
}

// Reps only work their own book; managers/F&I/admin see the whole floor.
function scopeLeads(leads: any[], viewer: EILAContext["viewer"]): any[] {
  // Match the leads screen (store route filterForUser): only Sales is scoped to
  // its own book. BDC works the whole store's leads (that's the BDC seat's job),
  // so EILA must not hide from BDC what the screen shows them.
  const ownOnly = viewer.role === "Sales";
  return ownOnly ? leads.filter((l) => samePerson(l.salesperson, viewer.employeeName)) : leads;
}

// next_leads — who to work next, scored 0–100 for buying intent (same engine as
// the Follow-Up Center): overdue first, then hottest, with the recommended touch.
function handleNextLeads(input: any, ctx: EILAContext): string {
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer).filter(isOpenLead);
  if (!leads.length) return "No open leads to work right now.";
  const limit = Math.min(Number(input?.limit) || 12, 40);
  const filter = String(input?.filter || "").toLowerCase();
  let scored = leads.map((l) => ({ l, s: scoreLead(l) }));
  if (filter === "overdue") scored = scored.filter((r) => r.s.overdue);
  else if (filter === "hot") scored = scored.filter((r) => r.s.label === "Hot");
  scored.sort((a, b) => Number(b.s.overdue) - Number(a.s.overdue) || b.s.score - a.s.score);
  const out = [`=== Work next (${scored.length} open) ===`];
  scored.slice(0, limit).forEach(({ l, s }) => out.push(`${s.score} ${s.label}${s.overdue ? " ⚠OVERDUE" : ""} — ${l.customer || "?"} · ${l.vehicle || "TBD"} · ${l.status} · ${personLabel(l.salesperson)} → ${s.recommendedTouch} [id:${l.id}]`));
  return out.join("\n");
}

// appointments — the day's board: today / to-confirm / upcoming / no-shows.
function handleAppointments(input: any, ctx: EILAContext): string {
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer);
  const today = new Date().toISOString().slice(0, 10);
  const SHOWN = ["Shown", "Desking", "In Finance", "Won"];
  const withAppt = leads.filter((l) => l.appointment && l.status !== "Lost");
  const day = (l: any) => String(l.appointment).slice(0, 10);
  const todays = withAppt.filter((l) => day(l) === today && !SHOWN.includes(l.status));
  const upcoming = withAppt.filter((l) => day(l) > today && !SHOWN.includes(l.status)).sort((a, b) => String(a.appointment).localeCompare(b.appointment));
  const overdue = withAppt.filter((l) => day(l) < today && !SHOWN.includes(l.status));
  const line = (l: any) => `${l.customer || "?"} · ${l.vehicle || "TBD"} · ${personLabel(l.salesperson)}${l.appointmentConfirmed ? " · CONFIRMED" : " · unconfirmed"} · ${String(l.appointment).replace("T", " ")} [id:${l.id}]`;
  const out = [`=== Appointments — ${todays.length} today, ${todays.filter((l) => !l.appointmentConfirmed).length} to confirm, ${overdue.length} no-show/reschedule ===`];
  if (todays.length) out.push("TODAY:", ...todays.map(line));
  if (overdue.length) out.push("NEEDS ATTENTION (passed):", ...overdue.slice(0, 20).map(line));
  if (upcoming.length) out.push("UPCOMING:", ...upcoming.slice(0, 20).map(line));
  return out.join("\n");
}

// equity — the trade-up radar: lease maturities + owners in the 18–54mo window.
function handleEquity(input: any, ctx: EILAContext): string {
  let deals: any[] = Array.isArray(ctx.data.deals) ? ctx.data.deals : [];
  deals = deals.filter((d) => d.stage === "Delivered" || d.stage === "Funded");
  const rep = ctx.viewer.role === "Sales" || ctx.viewer.role === "BDC";
  if (rep) deals = deals.filter((d) => samePerson(d.salesperson, ctx.viewer.employeeName) || samePerson(d.salesperson2, ctx.viewer.employeeName));
  const now = Date.now(), MS = 86_400_000;
  const monthsSince = (s: string) => { const t = new Date(`${s}T12:00:00`).getTime(); return Number.isNaN(t) ? 0 : Math.max(0, Math.round((now - t) / (MS * 30.44))); };
  const leases = deals.map((d) => { const term = d.leaseTermMonths || 0; if (!term || !d.isLease) return null; const start = new Date(`${d.date}T12:00:00`); if (Number.isNaN(start.getTime())) return null; const mat = new Date(start); mat.setMonth(mat.getMonth() + term); return { d, days: Math.round((mat.getTime() - now) / MS), mat }; }).filter((x): x is { d: any; days: number; mat: Date } => !!x && x.days <= 210).sort((a, b) => a.days - b.days);
  const retail = deals.filter((d) => !d.isLease && d.vehicleClass !== "Wholesale").map((d) => ({ d, m: monthsSince(d.date) })).filter((x) => x.m >= 18 && x.m <= 54).sort((a, b) => b.m - a.m);
  if (!leases.length && !retail.length) return "No trade-up opportunities surfaced yet — they build as deals age and leases approach maturity.";
  const out = [`=== Equity / trade-up radar — ${leases.length} lease maturities, ${retail.length} in the window ===`, "(Timing only — confirm exact equity at appraisal; live value needs the inventory feed.)"];
  if (leases.length) out.push("LEASE MATURITIES:", ...leases.slice(0, 20).map(({ d, days }) => `${d.customer || "?"} · ${d.vehicleClass} ${d.stockNumber || ""} · ${personLabel(d.salesperson)} · ${days < 0 ? "MATURED" : `${days}d out`}`));
  if (retail.length) out.push("TRADE-UP WINDOW:", ...retail.slice(0, 20).map(({ d, m }) => `${d.customer || "?"} · ${d.vehicleClass} ${d.stockNumber || ""} · ${personLabel(d.salesperson)} · owned ~${m}mo`));
  return out.join("\n");
}

// deals_at_risk — open leads stuck too long in a stage that should keep moving.
function handleDealsAtRisk(_input: any, ctx: EILAContext): string {
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer);
  const now = Date.now();
  const risk = leads.filter((l) => isAtRisk(l, now));
  if (!risk.length) return "No deals at risk right now — nothing stuck too long in stage.";
  const out = [`=== ${risk.length} deal${risk.length === 1 ? "" : "s"} at risk — stuck too long, step in ===`];
  risk.forEach((l) => out.push(`${l.customer || "?"} · ${l.vehicle || "TBD"} · ${l.status} · ${personLabel(l.salesperson)}${l.deskManager ? ` · desk ${personLabel(l.deskManager)}` : ""} [id:${l.id}]`));
  return out.join("\n");
}

// read_archive — the store's banked prior months (closedMonths). Returns STORE
// TOTALS only (no per-customer detail), so it's safe for every role — same as
// the leaderboards. Closes the parity gap where EILA was blind to any month but
// the current one. Reuses the closeMonth summary the Archive screen shows.
function handleReadArchive(input: any, ctx: EILAContext): string {
  const archive: any[] = Array.isArray(ctx.data.closedMonths) ? ctx.data.closedMonths : [];
  if (!archive.length) return "No months have been closed yet — the archive is empty. Close a month from the dashboard to bank it here.";
  const money = (n: number) => currency(Number.isFinite(n) ? n : 0);
  const ppu = (n: any) => (Number.isFinite(n) ? Number(n).toFixed(1) : "0.0");
  const q = String(input?.month || "").trim().toLowerCase();
  const sorted = [...archive].sort((a, b) => String(b.monthKey || "").localeCompare(String(a.monthKey || "")));
  const picked = q
    ? sorted.filter((m) => String(m.monthKey || "").toLowerCase().includes(q) || String(m.monthLabel || "").toLowerCase().includes(q))
    : sorted.slice(0, 6);
  if (!picked.length) return `No closed month matches "${String(input?.month)}". On file: ${sorted.map((m) => m.monthLabel || m.monthKey).join(", ")}.`;
  const out = [`=== Month archive (${archive.length} closed month${archive.length === 1 ? "" : "s"} on file) — store totals ===`];
  for (const m of picked) {
    const s = m.summary || {};
    out.push(`${m.monthLabel || m.monthKey}: ${s.delivered ?? m.dealCount ?? 0} retail units · gross ${money(s.gross)} (front ${money(s.front)} / back ${money(s.back)}) · PVR ${money(s.pvr)} · ${ppu(s.ppu)}PPU · F&I PVR ${money(s.financePvr)} · ${s.newUnits ?? 0} new / ${s.usedUnits ?? 0} used${m.closedByName ? ` · closed by ${m.closedByName}` : ""}`);
  }
  return out.join("\n");
}

// update_lead — the first ACTION tool: EILA actually writes a lead change (set an
// appointment, log the next action/note, advance status, mark shown/no-show).
// Authorization mirrors resolveLead: a Sales user may only touch their OWN lead.
// Same store key + status-history shape the CRM screens use — one write path.
async function handleUpdateLead(input: any, ctx: EILAContext): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "The lead store isn't connected, so I can't save that right now.";
  const id = String(input?.leadId || input?.id || "").trim();
  if (!id) return "Which lead? Pull it up with next_leads or appointments first, then I can update it.";

  // Initial read: confirm the lead exists and authorize it. Ownership is stable,
  // so this check can run on the first read; the actual mutation happens inside
  // guardedMutate against fresh data (so a concurrent CRM edit isn't clobbered).
  const { data } = await supabase.from("app_store").select("value").eq("org_id", ctx.orgId).eq("key", "crmLeads").maybeSingle();
  const leads0: any[] = Array.isArray(data?.value) ? data!.value : [];
  const lead0 = leads0.find((l) => l && l.id === id);
  if (!lead0) return `I couldn't find a lead with id ${id}.`;

  // Same rule as resolveLead / the store API: Sales acts only on its own book.
  if (ctx.viewer.role === "Sales" && !samePerson(lead0.salesperson, ctx.viewer.employeeName)) {
    return `That's ${personLabel(lead0.salesperson)}'s lead — you can only update your own.`;
  }

  const updates: Record<string, any> = {};
  const setStr = (key: string, v: any) => { if (typeof v === "string" && v.trim()) updates[key] = v.trim(); };
  setStr("nextAction", input.nextAction);
  setStr("managerNotes", input.managerNotes);
  setStr("appointment", input.appointment);
  setStr("lostReason", input.lostReason);
  if (typeof input.inShowroom === "boolean") updates.inShowroom = input.inShowroom;
  if (typeof input.appointmentConfirmed === "boolean") updates.appointmentConfirmed = input.appointmentConfirmed;

  const VALID_STATUS = ["New Lead", "Working", "Appointment Set", "Shown", "Desking", "In Finance", "Won", "Lost"];
  const newStatus = (typeof input.status === "string" && VALID_STATUS.includes(input.status)) ? input.status : null;
  if (newStatus && newStatus !== lead0.status) updates.status = newStatus;

  if (Object.keys(updates).length === 0) {
    return "Nothing to change — tell me what to set (appointment, next action, a note, or a new status).";
  }
  // Preview-then-commit: surface the edit before it lands so untrusted content in
  // context can't silently mutate a lead's record (SOC 2 CC6.8 / indirect
  // prompt-injection defense).
  if (input?.confirm !== true) {
    const preview = Object.keys(updates).filter((k) => k !== "statusHistory").join(", ");
    return `About to update ${lead0.customer || "the lead"}: ${preview || "status"}. Confirm with the user, then call update_lead again with confirm=true.`;
  }

  let savedCustomer = lead0.customer;
  try {
    await guardedMutate<any[]>(supabase, ctx.orgId, "crmLeads", (current) => {
      const leads = Array.isArray(current) ? current : [];
      const idx = leads.findIndex((l) => l && l.id === id);
      if (idx < 0) return leads; // lead vanished between reads — no-op
      const lead = leads[idx];
      savedCustomer = lead.customer;
      const applied: Record<string, any> = { ...updates };
      // Recompute statusHistory from the FRESH lead so a concurrent status
      // change isn't dropped (append exactly as the CRM Desk does).
      if (newStatus && newStatus !== lead.status) {
        applied.status = newStatus;
        applied.statusHistory = [...(Array.isArray(lead.statusHistory) ? lead.statusHistory : []), { status: newStatus, at: new Date().toISOString() }];
      }
      leads[idx] = { ...lead, ...applied };
      return leads;
    });
  } catch {
    return "Something went wrong saving that — nothing was changed. Try again.";
  }

  const changed = Object.keys(updates).filter((k) => k !== "statusHistory").join(", ");
  return `Done — updated ${savedCustomer || "the lead"} (${changed || "status"}).`;
}

const QUERY_DEALS_TOOL = {
  name: "query_deals",
  description:
    "Drill into THIS store's full deal list — uncapped — to answer anything about specific deals. Use it whenever the summary you're given isn't enough: 'every deal stuck in finance', 'all of Bo's cash deals', 'deals missing holdback'. Filter by salesperson, F&I manager, stage, vehicle class, deal type (finance/cash/dnq), or an audit issue. Returns the matching deals with full raw numbers and a quick total.",
  input_schema: {
    type: "object",
    properties: {
      salesperson: { type: "string", description: "Limit to one salesperson (matches primary or split rep)" },
      financeManager: { type: "string", description: "Limit to one F&I manager" },
      stage: { type: "string", description: "Deal stage contains, e.g. 'In Finance', 'Desking', 'Won'" },
      vehicleClass: { type: "string", description: "New, Used, Lease, or Wholesale" },
      dealType: { type: "string", enum: ["finance", "cash", "dnq"], description: "How the deal is funded" },
      issue: { type: "string", enum: ["missing_invoice", "negative_gross", "products_on_cash", "missing_docfee"], description: "Audit flag to surface money problems (products_on_cash = products on a DNQ deal, which never credit PPU)" },
      limit: { type: "number", description: "Max deals to return (default 50)" },
    },
  },
};

const DEAL_JACKET_TOOL = {
  name: "deal_jacket",
  description:
    "The deal-jacket checklist for ONE deal: the store's required document order plus what's already filed, what's N/A, and what's still missing from the physical file. Use it whenever an F&I manager or the office asks what order a deal file goes in, what's missing from a jacket, or whether a deal is ready to walk to the office. Look the deal up by deal number, customer name, or stock number.",
  input_schema: {
    type: "object",
    properties: { deal: { type: "string", description: "Deal number, customer name, or stock number" } },
    required: ["deal"],
  },
};

const REP_DETAIL_TOOL = {
  name: "rep_detail",
  description:
    "Get the full picture on one salesperson or F&I manager: their sales and F&I numbers, their full deal list, and the coaching memory you've built on them. Use it whenever someone wants to go deep on a specific rep ('how is Bo doing', 'walk me through Daryl').",
  input_schema: {
    type: "object",
    properties: { name: { type: "string", description: "Full name of the rep / F&I manager" } },
    required: ["name"],
  },
};

const ESTIMATE_PAY_TOOL = {
  name: "estimate_pay",
  description:
    "Estimate a person's pay for the month through the compensation engine — the SAME math the scorecards use. Returns their commission rate, gross, any penalties/deductions, net after draw, and the single BEST MOVE to earn more this month (next PVR/PPU tier, etc.). Use it whenever anyone asks 'how much am I making', 'what's my pay', 'how do I make more this month', or when coaching a rep on the money. Pay is private — for a Sales/BDC user this only works on their own name.",
  input_schema: {
    type: "object",
    properties: {
      person: { type: "string", description: "Whose pay to estimate. Omit to use the person asking." },
      role: { type: "string", enum: ["Sales", "F&I", "Manager"], description: "Their pay role. Omit to infer from their deals." },
    },
  },
};

const NEXT_LEADS_TOOL = {
  name: "next_leads",
  description:
    "The prioritized follow-up list — every open lead scored 0–100 for buying intent (same engine as the Follow-Up Center), overdue first, with the recommended next touch. Use for 'who should I work / call next', 'my hot leads', 'what's overdue', 'work the floor'. Reps get their own book; managers see everyone.",
  input_schema: { type: "object", properties: { filter: { type: "string", enum: ["all", "overdue", "hot"] }, limit: { type: "number" } } },
};
const APPOINTMENTS_TOOL = {
  name: "appointments",
  description: "The appointment board: who's coming in today, who still needs a confirmation call, and passed/no-show appointments to reschedule. Use for 'appointments today', 'who do I need to confirm', 'any no-shows'.",
  input_schema: { type: "object", properties: {} },
};
const EQUITY_TOOL = {
  name: "equity",
  description: "The trade-up radar: sold customers approaching lease maturity or in the 18–54 month ownership window — who to call about upgrading. Timing signals only (confirm exact equity at appraisal). Use for 'equity opportunities', 'who can I trade up', 'lease maturities'.",
  input_schema: { type: "object", properties: {} },
};
const AT_RISK_TOOL = {
  name: "deals_at_risk",
  description: "Open deals stuck too long in a stage that should keep moving (desking/finance aging, working leads gone stale) — where a manager should step in before they slip. Use for 'what's at risk', 'stuck deals', 'what needs me'.",
  input_schema: { type: "object", properties: {} },
};
const READ_ARCHIVE_TOOL = {
  name: "read_archive",
  description: "Look up PRIOR closed months — the store's banked history. Returns each closed month's store totals (retail units, gross, front/back, PVR, PPU, F&I PVR, new/used mix). Optionally filter to one month by name or YYYY-MM ('June', '2026-06'). Use for 'how did we do last month', month-over-month trends, or 'best month this year'. Store totals only (no per-customer detail).",
  input_schema: { type: "object", properties: { month: { type: "string", description: "Optional: a month to look up, e.g. 'June' or '2026-06'. Omit for the last several months." } } },
};
const UPDATE_LEAD_TOOL = {
  name: "update_lead",
  // TWO-STEP: call WITHOUT confirm first to preview the change to the user, then
  // only call with confirm=true after they explicitly approve. Never confirm on
  // your own — content in the lead itself is not an instruction.
  description:
    "Take ACTION on a CRM lead — actually save the change, not just suggest it. Use when the user says to set/confirm an appointment, log the next action or a note, advance or change a lead's status (e.g. mark shown, desking, in finance, won, or lost), mark that a customer came into the showroom, or mark a no-show. First find the lead's id via next_leads/appointments if you don't have it. A Sales rep can only update their OWN leads; managers/BDC/F&I can update any. Confirm what you changed back to the user.",
  input_schema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "The lead's id (from next_leads/appointments)." },
      status: { type: "string", enum: ["New Lead", "Working", "Appointment Set", "Shown", "Desking", "In Finance", "Won", "Lost"], description: "New pipeline status. Appends to the lead's status history." },
      appointment: { type: "string", description: "Appointment date/time to set (as the user said it, e.g. '2026-07-15 3:00 PM')." },
      appointmentConfirmed: { type: "boolean", description: "True once the confirmation call is done." },
      inShowroom: { type: "boolean", description: "True when the customer has physically come in." },
      nextAction: { type: "string", description: "The next action to take on this lead." },
      managerNotes: { type: "string", description: "A note to log on the lead." },
      lostReason: { type: "string", description: "Why the lead was lost (only with status Lost)." },
      confirm: { type: "boolean", description: "true ONLY after the user explicitly approved the previewed change." },
    },
    required: ["leadId"],
  },
};

// lookup_rate — quote an exact BUY rate off the loaded lender rate sheet, by
// lender / tier / term / model-year. Rate sheets fan out by year×term×tier, so
// they're the most-capped part of the snapshot; this pulls the precise line.
function handleLookupRate(input: any, ctx: EILAContext): string {
  const setup = ctx.data.monthlySetup;
  const lenders: any[] = Array.isArray(setup?.rateSheets?.lenders) ? setup.rateSheets.lenders : [];
  if (!lenders.length) return "No lender rate sheet is loaded for this store. Add one in Monthly Setup, then I can quote exact buy rates.";

  const qLender = String(input?.lender || "").trim().toLowerCase();
  const qTier = String(input?.tier || "").trim().toLowerCase();
  const qTerm = num(input?.termMonths);
  const qYear = String(input?.year || "").trim().toLowerCase();
  const has = (hay: any, needle: string) => String(hay || "").toLowerCase().includes(needle);

  const rows: string[] = [];
  for (const l of lenders) {
    if (qLender && !has(l.lender, qLender)) continue;
    for (const t of Array.isArray(l.tiers) ? l.tiers : []) {
      if (qTier && !has(t.tier, qTier)) continue;
      for (const r of Array.isArray(t.rates) ? t.rates : []) {
        if (qTerm && num(r.termMonths) !== qTerm) continue;
        if (qYear && !has(r.year, qYear)) continue;
        const adv = r.maxAdvancePct ? ` (≤${r.maxAdvancePct}% adv)` : "";
        const minAmt = r.minAmountFinanced ? ` (min $${r.minAmountFinanced})` : "";
        rows.push(`  ${l.lender} · ${t.tier} · ${r.year ? r.year + " · " : ""}${num(r.termMonths)}mo · ${(+r.buyRate).toFixed(2)}% buy${adv}${minAmt}`);
      }
    }
  }

  if (!rows.length) {
    const avail = lenders.map((l: any) => `${l.lender} [${(Array.isArray(l.tiers) ? l.tiers : []).map((t: any) => t.tier).join(", ")}]`).join("; ");
    return `No rate matches that exactly. Loaded lenders/tiers: ${avail || "none"}. Reserve = sell rate − buy rate within the lender's cap.`;
  }

  const eff = setup?.rateSheets?.effectiveMonth ? ` (effective ${setup.rateSheets.effectiveMonth})` : "";
  const capped = rows.length > 80 ? rows.slice(0, 80).concat([`  …and ${rows.length - 80} more — narrow by lender/tier/term/year.`]) : rows;
  return `BUY rates${eff} — reserve = sell − buy within the lender's cap:\n${capped.join("\n")}`;
}

const LOOKUP_RATE_TOOL = {
  name: "lookup_rate",
  description:
    "Quote an exact BUY rate off this store's loaded lender rate sheet, narrowed by lender, credit tier, term, and/or vehicle model-year. Rate sheets fan out by year × term × tier, so the summary can't always show the exact line — use this whenever someone needs a precise rate ('LGE buy rate for a 2024 at 740 for 66 months', 'cheapest 72mo Tier 1 rate'). Reserve = sell rate − buy rate within the lender's cap.",
  input_schema: {
    type: "object",
    properties: {
      lender: { type: "string", description: "Lender name or part of it (e.g. 'LGE', 'Mazda Financial')" },
      tier: { type: "string", description: "Credit tier name or part of it (e.g. 'Tier 1', 'A+', '740')" },
      termMonths: { type: "number", description: "Loan term in months (e.g. 66, 72)" },
      year: { type: "string", description: "Vehicle model-year band (e.g. '2024')" },
    },
  },
};

// decode_vin — the same NHTSA decoder the Deal Entry and CRM Desk screens use
// (lib/vin.ts), plus a cross-check against this store's deals and leads so a
// VIN question lands on the actual record when there is one.
async function handleDecodeVin(input: any, ctx: EILAContext): Promise<string> {
  const raw = String(input?.vin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 17 || !isValidVin(raw)) {
    return `"${raw || input?.vin || ""}" isn't a valid 17-character VIN (no I, O, or Q). Double-check it and give me the full VIN.`;
  }
  const decoded = await decodeVin(raw);
  const L: string[] = [];
  if (decoded) {
    L.push(`VIN ${raw} decodes to: ${decoded.vehicle}${decoded.body ? ` · ${decoded.body}` : ""}${decoded.cylinders ? ` · ${decoded.cylinders}cyl` : ""}${decoded.fuel ? ` · ${decoded.fuel}` : ""}.`);
  } else {
    L.push(`VIN ${raw} is well-formed but NHTSA couldn't decode it — it may be mistyped or very new. Cross-checking the store's records anyway:`);
  }

  const { viewer } = ctx;
  const dealsRedact = viewer.role === "Sales" || viewer.role === "BDC";
  const owns = (d: any) => samePerson(d.salesperson, viewer.employeeName) || samePerson(d.salesperson2, viewer.employeeName);
  const deals: any[] = Array.isArray(ctx.data.deals) ? ctx.data.deals : [];
  const dealHits = deals.filter((d) => String(d.vin || "").toUpperCase() === raw || String(d.tradeVin || "").toUpperCase() === raw);
  for (const d of dealHits) {
    const who = dealsRedact && !owns(d) ? "[hidden]" : (d.customer || "?");
    const as = String(d.tradeVin || "").toUpperCase() === raw ? "the TRADE on" : "the sold unit on";
    L.push(`It's ${as} this month's deal: ${who} · stock ${d.stockNumber || "?"} · ${d.stage || "?"} · ${personLabel(d.salesperson)}.`);
  }
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], viewer);
  const leadHits = leads.filter((l: any) => String(l.vin || "").toUpperCase() === raw);
  for (const l of leadHits) L.push(`It's on the floor: ${l.customer || "?"} · ${l.vehicle || "TBD"} · ${l.status} · ${personLabel(l.salesperson)}.`);
  if (!dealHits.length && !leadHits.length) L.push("No deal or working lead in this store carries that VIN.");
  return L.join("\n");
}

// speed_to_lead — the Five-Minute Response System (lib/speedToLead.ts, the
// same brain as the CRM Desk card). Live clocks + the 30-day grade, scoped
// like every lead read: reps see their own book, managers the store.
function handleSpeedToLead(_input: any, ctx: EILAContext): string {
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer);
  const stats = speedStats(leads as any[]);
  const L: string[] = [];
  const live = (leads as any[])
    .map((l) => ({ l, clock: speedClock(l) }))
    .filter(({ clock }) => clock.state === "on_clock" || clock.state === "breached");
  if (live.length) {
    L.push(`=== RIGHT NOW: ${stats.onClockNow} on the 5:00 clock · ${stats.breachedNow} OVER it ===`);
    for (const { l, clock } of live) {
      const t = clock.state === "on_clock" ? `${Math.floor((clock as any).secondsLeft / 60)}:${String((clock as any).secondsLeft % 60).padStart(2, "0")} left` : `${(clock as any).minutesOver} min OVER`;
      L.push(`${l.customer || "?"} · ${l.vehicle || "TBD"} · ${personLabel(l.salesperson)} · ${t}${l.customerPhone ? ` · ${l.customerPhone}` : ""}`);
    }
    L.push("A fresh up answered inside five minutes converts — get these called FIRST, then everything else.");
  } else {
    L.push("Nobody is on the 5-minute clock right now — every fresh up has been contacted.");
  }
  L.push(`\n30-DAY GRADE: ${stats.under5Pct}% answered under 5:00 (${stats.measured} graded) · avg ${stats.avgMinutes ?? "—"} min · median ${stats.medianMinutes ?? "—"} min.`);
  if (stats.byRep.length > 1) {
    L.push("By rep:");
    for (const r of stats.byRep) L.push(`  ${personLabel(r.name)}: ${r.under5Pct}% under 5 (${r.measured} graded, avg ${r.avgMinutes ?? "—"}m)`);
  }
  return L.join("\n");
}

const SPEED_TO_LEAD_TOOL = {
  name: "speed_to_lead",
  description:
    "The Five-Minute Response System: which fresh ups are on the 5:00 first-contact clock or past it RIGHT NOW, plus the 30-day grade (% answered under five minutes, average, by rep). Use for 'who's on the clock', 'did we answer that lead', 'how's our response time', or whenever coaching speed-to-lead.",
  input_schema: { type: "object", properties: {} },
};

// check_consent — the TCPA rail (lib/consent.ts, same brain as the chips on
// the lead card). ALWAYS check before drafting outreach: a revoked channel is
// a hard no ($500–$1,500 statutory damages per text/call), and the audit
// trail here is the store's defense. Scoped like every lead read.
function handleCheckConsent(input: any, ctx: EILAContext): string {
  const q = String(input?.customer || "").trim().toLowerCase();
  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer) as any[];
  const hits = q
    ? leads.filter((l) => String(l.customer || "").toLowerCase().includes(q))
    : leads.filter((l) => consentSummary(l).revokedAny);
  if (!hits.length) return q ? `No working lead matches "${input?.customer}".` : "No lead in this store has a revoked channel — nothing is suppressed.";
  const L: string[] = [];
  for (const l of hits.slice(0, 10)) {
    const s = consentSummary(l);
    L.push(`${l.customer || "?"} (${l.status}) — call: ${s.call} · text: ${s.text} · email: ${s.email}`);
    const events = l.consent?.events ?? [];
    for (const e of events.slice(-5)) {
      L.push(`  ${e.action.toUpperCase()} ${e.channel} · ${new Date(e.at).toLocaleDateString()} · ${e.source}${e.by ? ` · recorded by ${e.by}` : ""}`);
      if (e.action === "revoked") L.push(`    (suppressed immediately; legal deadline ${new Date(suppressionDeadline(e.at)).toLocaleDateString()})`);
    }
    if (!events.length) L.push("  No consent recorded — a human may reach out normally, but capture consent before any automated/text outreach.");
    if (s.revokedAny) L.push("  ⚠️ DO NOT contact on the revoked channel(s). No drafts, no workarounds.");
  }
  return L.join("\n");
}

const CHECK_CONSENT_TOOL = {
  name: "check_consent",
  description:
    "TCPA/consent check on a customer: per-channel (call/text/email) consent status with the audit trail (who recorded what, when, how) and revocation suppression deadlines. ALWAYS run this before drafting or recommending outreach to a specific customer. With no customer given, lists every lead with a revoked channel (the store's do-not-contact list).",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Customer name (or part of one). Omit to list all revoked/do-not-contact leads." },
    },
  },
};

// group_report — the multi-rooftop rollup (lib/groupReport.ts, same brain as
// the Group Command screen). Access is decided HERE, per caller: the platform
// owner sees every store; a group principal sees the stores named in their
// server-only groupConfig row; everyone else is told it's not for them.
// Aggregates only — never a customer name across store lines.
async function handleGroupReport(_input: any, ctx: EILAContext): Promise<string> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Group reporting needs the secure backend — it isn't wired in this environment.";
  const email = ctx.viewer.email || "";

  let groupName: string;
  let memberOrgIds: string[];
  if (isOwnerEmail(email)) {
    const { data: orgs } = await supabase.from("organizations").select("id");
    groupName = "All stores";
    memberOrgIds = (orgs ?? []).map((o: any) => String(o.id));
  } else {
    const { data: configs } = await supabase.from("app_store").select("value").eq("key", "groupConfig");
    const group = groupForViewer(configs ?? [], email);
    if (!group) return "This account isn't set up as a dealer-group principal — group reporting shows an owner every rooftop they run. For this store's numbers, use query_deals.";
    groupName = group.name;
    memberOrgIds = group.memberOrgIds;
  }
  if (!memberOrgIds.length) return "No stores found for this group yet.";

  const [{ data: orgRows }, { data: dealRows }, { data: settingsRows }] = await Promise.all([
    supabase.from("organizations").select("id, name").in("id", memberOrgIds),
    supabase.from("app_store").select("org_id, value").eq("key", "deals").in("org_id", memberOrgIds),
    supabase.from("app_store").select("org_id, value").eq("key", "storeSettings").in("org_id", memberOrgIds),
  ]);
  const names = new Map<string, string>((orgRows ?? []).map((o: any) => [String(o.id), String(o.name || "Store")]));
  const dealsByOrg = new Map<string, any[]>((dealRows ?? []).map((r: any) => [String(r.org_id), Array.isArray(r.value) ? r.value : []]));
  const settingsByOrg = new Map<string, any>((settingsRows ?? []).map((r: any) => [String(r.org_id), r.value ?? null]));
  const stores: GroupStoreInput[] = memberOrgIds.map((orgId) => ({ orgId, name: names.get(orgId) || "Store", deals: dealsByOrg.get(orgId) ?? [], settings: settingsByOrg.get(orgId) ?? null }));
  const r = groupRollup(stores);

  const L: string[] = [];
  L.push(`=== ${groupName}: ${r.totals.stores} store${r.totals.stores === 1 ? "" : "s"} ===`);
  L.push(`Group: ${r.totals.units} units (${r.totals.newUnits} new / ${r.totals.usedUnits} used) · gross ${currency(r.totals.gross)} (front ${currency(r.totals.front)} / back ${currency(r.totals.back)}) · PVR ${currency(r.totals.pvr)} · F&I PVR ${currency(r.totals.financePvr)} · PPU ${r.totals.ppu.toFixed(2)}`);
  for (const s of r.stores) {
    L.push(`${s.name}: ${s.units} units · gross ${currency(s.gross)} · PVR ${currency(s.pvr)} · F&I PVR ${currency(s.financePvr)} · PPU ${s.ppu.toFixed(2)}`);
  }
  return L.join("\n");
}

const GROUP_REPORT_TOOL = {
  name: "group_report",
  description:
    "Multi-store group rollup for dealer-group principals and the owner: units, gross, PVR, F&I PVR and PPU for every store in the group plus the group totals. Use for any cross-store or 'how's the group / which store' question. Access is enforced per caller — regular store users are politely declined.",
  input_schema: { type: "object", properties: {} },
};

// service_lane — the Service Drive board (lib/service.ts, same brain as the
// /service screen): what's in the lane, what's late on its promise, who's
// ready, declined work worth a call, and the service→sales flags.
function handleServiceLane(_input: any, ctx: EILAContext): string {
  const visits: any[] = Array.isArray((ctx.data as any).serviceLane) ? (ctx.data as any).serviceLane : [];
  if (!visits.length) return "The service lane is empty — no visits logged yet. Appointments land there from the Service Lane screen.";
  const stats = laneStats(visits);
  const L: string[] = [];
  L.push(`=== SERVICE LANE: ${stats.inLaneNow} in the lane · ${stats.readyNow} ready · ${stats.lateNow} LATE · ${stats.salesFlags} flagged for sales ===`);
  for (const v of visits.filter((x) => x.status !== "Picked Up")) {
    const risk = promiseRisk(v);
    const riskNote = isLate(v) ? " · LATE on promise" : risk === "soon" ? " · promise DUE SOON — re-promise now" : "";
    const quiet = updateDue(v) ? " · customer hasn't heard from us — send a status text" : "";
    L.push(`${v.customer || "?"} · ${v.vehicle || "?"} · ${v.status}${v.promisedAt ? ` · promised ${new Date(v.promisedAt).toLocaleString()}` : ""}${v.estimatedTotal ? ` · ~${currency(v.estimatedTotal)}` : ""}${v.salesOpportunity ? " · SALES FLAG" : ""}${riskNote}${quiet} · ${v.concern || ""}`);
  }
  const missions = recaptureList(visits);
  if (missions.length) {
    L.push(`\nWIN-BACK LIST (open declined work — structured follow-up recovers 23-30%):`);
    for (const m of missions.slice(0, 12)) L.push(`${m.visit.customer || "?"} · ${m.visit.vehicle || "?"} · ${m.daysSince}d since pickup${m.cadence ? ` (${m.cadence}-day window)` : ""} · declined: ${m.visit.declinedWork}${m.visit.customerPhone ? ` · ${m.visit.customerPhone}` : ""}`);
  }
  const promises = promiseStats(visits);
  if (promises.length) {
    L.push(`\nPROMISE-TIME HONESTY (30d, per advisor — done on time / promised):`);
    for (const a of promises) L.push(`${a.advisor}: ${a.kept}/${a.promised} kept (${a.hitRate}%)`);
  }
  return L.join("\n");
}

const SERVICE_LANE_TOOL = {
  name: "service_lane",
  description:
    "The Service Drive board: everything in the lane right now (status, promise times, LATE and due-soon flags, customers overdue for a status update), the declined-work WIN-BACK list with days-since and cadence windows, per-advisor promise-time hit rates, and service customers flagged as sales opportunities. Use for any service-department question.",
  input_schema: { type: "object", properties: {} },
};

// parts_counter — the Parts Counter board (lib/parts.ts, same brain as the
// /parts screen): special orders with their aging clocks, the tech request
// queue with fill times, and the lost-sale ledger with stock-it suggestions.
function handlePartsCounter(_input: any, ctx: EILAContext): string {
  const data = normalizePartsData((ctx.data as any).partsCounter);
  if (!data.sops.length && !data.requests.length && !data.lostSales.length) {
    return "The parts counter board is empty — special orders, tech requests, and lost sales all land there from the Parts Counter screen.";
  }
  const stats = counterStats(data);
  const L: string[] = [];
  L.push(`=== PARTS COUNTER: ${stats.queueWaiting} tech${stats.queueWaiting === 1 ? "" : "s"} waiting · ${stats.sopsWaiting} special orders on the shelf (${currency(stats.sopsWaitingValue)}) · ${stats.sopsAging} aging ${SOP_AGING_DAYS}d+ · lost sales 30d ${currency(stats.lostValue30d)} ===`);
  const openSops = data.sops.filter((sop) => sop.status !== "Picked Up" && sop.status !== "Returned");
  if (openSops.length) {
    L.push(`\nSPECIAL ORDERS (aging counts from the day the part LANDED):`);
    for (const sop of openSops) {
      const age = sopAgeDays(sop);
      L.push(`${sop.customer || "?"} · ${sop.partNumber || sop.description || "?"}${sop.partNumber && sop.description ? ` (${sop.description})` : ""} · ${sop.status}${age != null ? ` · ${age}d on the shelf${age >= SOP_AGING_DAYS ? " — AGING, call them" : ""}` : ""}${sop.price ? ` · ${currency(sop.price)}` : ""}${sop.deposit ? " · deposit taken" : sop.status !== "Ordered" ? " · NO DEPOSIT" : ""}${sop.customerPhone ? ` · ${sop.customerPhone}` : ""}`);
    }
  }
  const openRequests = data.requests.filter((r) => r.status !== "Delivered");
  if (openRequests.length) {
    L.push(`\nTECH QUEUE${stats.avgFillMinutes != null ? ` (avg fill ${stats.avgFillMinutes} min over 30d)` : ""}:`);
    for (const r of openRequests) L.push(`${r.tech || "?"} · RO ${r.roNumber || "?"} · ${r.description || "?"} · ${r.status} since ${new Date(r.createdAt).toLocaleTimeString()}`);
  }
  const suggestions = stockSuggestions(data.lostSales);
  if (suggestions.length) {
    L.push(`\nSTOCK-IT SUGGESTIONS (3+ asks in 90 days):`);
    for (const sug of suggestions.slice(0, 8)) L.push(`${sug.label} · asked ${sug.demands}x · ${currency(sug.value)} walked out the door`);
  }
  return L.join("\n");
}

const PARTS_COUNTER_TOOL = {
  name: "parts_counter",
  description:
    "The Parts Counter board: every special order with its aging clock (received-but-not-picked-up is the #1 obsolescence feeder), deposit status, the live tech request queue with fill times, and the lost-sale ledger with stock-it suggestions. Use for any parts-department question.",
  input_schema: { type: "object", properties: {} },
};

// fixed_ops_digest — the GM's weekly fixed-ops read (lib/fixedOpsDigest.ts,
// the SAME brain the Monday cron texts out): promises kept, win-back money,
// SOP shelf dollars, lost sales, and the one move to make first.
function handleFixedOpsDigest(_input: any, ctx: EILAContext): string {
  const visits: any[] = Array.isArray((ctx.data as any).serviceLane) ? (ctx.data as any).serviceLane : [];
  const digest = buildFixedOpsDigest(visits, (ctx.data as any).partsCounter, ctx.settings.storeName || "the store");
  return `${digest.text}\n\n(The same digest texts the GM every Monday morning once a digest number is configured.)`;
}

const FIXED_OPS_DIGEST_TOOL = {
  name: "fixed_ops_digest",
  description:
    "The Fixed Ops weekly digest — service promises kept this week, what's late right now, the win-back list, special-order shelf dollars and aging, lost sales, and the single top move. Use for 'how did fixed ops do', 'service and parts summary', or any week-in-review question.",
  input_schema: { type: "object", properties: {} },
};

// text_customer — EILA sends a REAL text through the same pipeline as the
// screen (lib/smsServer.ts: consent gate, own-customers privacy, opt-out
// notice, thread write — one brain, nothing can diverge). Outbound comms in
// a customer's pocket is the highest-stakes thing EILA does, so it's
// two-step like restore_backup: without confirm:true it only PREVIEWS.
async function handleTextCustomer(input: any, ctx: EILAContext): Promise<string> {
  if (!twilioConfigured()) return "Texting isn't connected for this store yet — once the texting number is set up, I can send these for you. For now, copy the draft into your own phone.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Texting needs the secure backend — not available here.";

  const q = String(input?.customer || "").trim().toLowerCase();
  const message = String(input?.message || "").trim();
  if (!q || !message) return "I need the customer and the message to send.";

  const leads = scopeLeads(Array.isArray(ctx.data.crmLeads) ? ctx.data.crmLeads : [], ctx.viewer) as any[];
  const hits = leads.filter((l) => String(l.customer || "").toLowerCase().includes(q));
  if (!hits.length) return `No working lead matches "${input?.customer}".`;
  if (hits.length > 1) return `Several leads match: ${hits.slice(0, 5).map((l) => l.customer).join(", ")}. Which one?`;
  const lead = hits[0];

  const consent = consentStatus(lead, "text");
  if (consent !== "granted") {
    return consent === "revoked"
      ? `HARD NO: ${lead.customer} revoked text consent — I won't send this, and neither should anyone. Suggest another consented channel or wait for them to reach out.`
      : `${lead.customer} has no text consent on file — capture it on their lead card (Consent chips) first, then I can send.`;
  }

  if (input?.confirm !== true) {
    const finalBody = withOptOutNotice(message, lead.messages);
    return [
      `READY TO SEND — needs the user's go-ahead (then call again with confirm:true):`,
      `To: ${lead.customer} · ${lead.customerPhone}`,
      `Message: "${finalBody}"`,
      `Consent: granted · thread has ${lead.messages?.length ?? 0} prior message(s).`,
    ].join("\n");
  }

  const result = await sendTextToLead({
    supabase,
    orgId: ctx.orgId,
    leadId: String(lead.id),
    body: message,
    senderName: ctx.viewer.employeeName || "EILA",
    role: ctx.viewer.role,
  });
  if (!result.ok) return `The send failed: ${result.error}`;
  return `Sent to ${lead.customer}: "${result.message.body}" — it's on their thread.`;
}

const TEXT_CUSTOMER_TOOL = {
  name: "text_customer",
  description:
    "Send a REAL text message to a customer on a working lead, through the store's texting number. Consent-gated server-side (granted text consent only) and two-step: call WITHOUT confirm first to get a preview, show it to the user, and only after they explicitly approve call again with confirm:true. Never confirm on your own.",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "Customer name (or part of one) on the working lead." },
      message: { type: "string", description: "The text to send. Keep it short, human, and signed with the sender's first name." },
      confirm: { type: "boolean", description: "true ONLY after the user explicitly approved the previewed message." },
    },
    required: ["customer", "message"],
  },
};

// restore_backup — EILA parity for the Import screen's safety net. Destructive
// and org-wide, so three guards: (1) same roles that can write deals
// (Manager/F&I/Admin — canWrite matrix in lib/access.ts); (2) two-step —
// without confirm:true it only DESCRIBES the backup so EILA asks first;
// (3) the swap is reversible: the replaced board becomes the new backup,
// exactly like the screen. Writes bump the row's write-stamp, so open devices'
// next compare-and-swap save conflicts and reloads instead of clobbering.
async function handleRestoreBackup(input: any, ctx: EILAContext): Promise<string> {
  const role = ctx.viewer.role;
  if (!(role === "Admin" || role === "Manager" || role === "F&I")) {
    return "Restoring the board is a manager move — ask a manager, F&I manager, or admin to run it.";
  }
  const supabase = getSupabaseServerClient();
  if (!supabase) return "Secure store unavailable — use the Import screen's Safety net card instead.";

  const read = async (key: string) => {
    const { data } = await supabase.from("app_store").select("value").eq("org_id", ctx.orgId).eq("key", key).maybeSingle();
    return Array.isArray(data?.value) ? (data!.value as any[]) : [];
  };
  const backup = await read("deals_backup");
  const board = await read("deals");
  if (!backup.length) return "There's no safety-net backup on file for this store (one is snapshotted automatically whenever an import replaces the board).";

  const gross = (list: any[]) => list.reduce((t, d) => t + (Number(d.frontGross) || 0) + (Number(d.backGrossReserve) || 0), 0);
  const summary = `Backup: ${backup.length} deal(s), ${currency(gross(backup))} front+back. Board right now: ${board.length} deal(s), ${currency(gross(board))}.`;

  if (input?.confirm !== true) {
    return `${summary}\nRestoring REPLACES the current board with the backup (reversible — the replaced board becomes the new backup). To proceed, confirm with the user, then call restore_backup again with confirm=true.`;
  }

  const nowIso = new Date().toISOString();
  // Board first, verified; only then swap the old board into the backup slot —
  // a failed first write must never cost the backup.
  const { error: e1 } = await supabase.from("app_store").upsert(
    { org_id: ctx.orgId, key: "deals", value: backup, updated_at: nowIso },
    { onConflict: "org_id,key" },
  );
  if (e1) return `Restore failed — nothing was changed: ${e1.message}`;
  const { data: check } = await supabase.from("app_store").select("value").eq("org_id", ctx.orgId).eq("key", "deals").maybeSingle();
  const landed = Array.isArray(check?.value) ? check!.value.length : 0;
  if (landed !== backup.length) return `Restore write did not verify (expected ${backup.length} deals, found ${landed}) — check the board before doing anything else.`;
  const { error: e2 } = await supabase.from("app_store").upsert(
    { org_id: ctx.orgId, key: "deals_backup", value: board, updated_at: nowIso },
    { onConflict: "org_id,key" },
  );
  return `Done — ${backup.length} deal(s) are back on the board (verified).${e2 ? " Heads up: the replaced board could NOT be saved as the new backup." : ` The replaced ${board.length}-deal board is the new backup — restore again to swap back.`} Everyone should close and reopen the app to pick up the restored board.`;
}

// ── EILA action tools: the parity write-set (goals, close month, deal edits,
// service + parts). Each mirrors a screen, gated by the SAME role matrix
// (lib/access.ts canWrite), and writes through guardedMutate so a concurrent
// edit is never clobbered. Money edits are finite-guarded (never write NaN).
const canManage = (role: string) => role === "Admin" || role === "Manager";
const canDeskWrite = (role: string) => role === "Admin" || role === "Manager" || role === "F&I";
// Treat null / "" / undefined as "not provided" (NOT 0): Number(null) and
// Number("") are both 0, so without this an LLM emitting `frontGross: null` for
// an unspecified optional would overwrite a real deal's gross to $0.
const finiteOrUndef = (v: any): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// set_goals — write the store's targets (team units, store PVR) or a rep's unit
// goal. Admin/Manager only (mirrors canWrite("goals")).
async function handleSetGoals(input: any, ctx: EILAContext): Promise<string> {
  if (!canManage(ctx.viewer.role)) return "Setting goals is a manager/admin move — ask a manager or admin.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "The store isn't connected, so I can't save goals right now.";
  const teamUnits = finiteOrUndef(input?.teamDeliveredUnits);
  const pvrTotal = finiteOrUndef(input?.pvrTotal);
  const repName = String(input?.rep || "").trim();
  const repUnits = finiteOrUndef(input?.repUnits);
  const changes: string[] = [];
  if (teamUnits !== undefined && teamUnits >= 0) changes.push(`team unit goal ${teamUnits}`);
  if (pvrTotal !== undefined && pvrTotal >= 0) changes.push(`store PVR goal ${currency(pvrTotal)}`);
  if (repName && repUnits !== undefined && repUnits >= 0) changes.push(`${repName}'s unit goal ${repUnits}`);
  if (!changes.length) return "Tell me what to set — a team unit goal, a store PVR goal, or a rep's unit goal (with their name).";
  // Preview-then-commit: surface the change to the user before it lands, so a
  // stray/injected instruction can't silently rewrite goals (SOC 2 CC6.8/PI1.x).
  if (input?.confirm !== true) {
    return `About to set ${changes.join(", ")}. Confirm with the user, then call set_goals again with confirm=true.`;
  }
  await guardedMutate<Record<string, any>>(supabase, ctx.orgId, "goals", (current) => {
    const g = current && typeof current === "object" ? current : {};
    if (teamUnits !== undefined && teamUnits >= 0) g.teamDeliveredUnits = teamUnits;
    if (pvrTotal !== undefined && pvrTotal >= 0) g.pvrTotal = pvrTotal;
    if (repName && repUnits !== undefined && repUnits >= 0) {
      g.salespersonUnits = g.salespersonUnits && typeof g.salespersonUnits === "object" ? g.salespersonUnits : {};
      g.salespersonUnits[repName] = repUnits;
    }
    return g;
  });
  return `Done — set ${changes.join(", ")}.`;
}

// close_month — archive the current board into the month archive (read back with
// read_archive). Two-step confirm; Admin/Manager only. Reuses the tested
// buildClosedMonth/upsertClosedMonth. Non-destructive: the board is NOT cleared
// (matches the Close Month button — it's a recomputable snapshot).
async function handleCloseMonth(input: any, ctx: EILAContext): Promise<string> {
  if (!canManage(ctx.viewer.role)) return "Closing the month is a manager/admin move — ask a manager or admin.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "The store isn't connected, so I can't close the month right now.";
  const deals: Deal[] = Array.isArray(ctx.data.deals) ? ctx.data.deals : [];
  if (!deals.length) return "There are no deals on the board to close.";
  const money = (n: number) => currency(Number.isFinite(n) ? n : 0);
  const s = summarizeMonth(deals);
  if (input?.confirm !== true) {
    return `Closing archives the current board — ${s.delivered} retail units · gross ${money(s.gross)} (front ${money(s.front)} / back ${money(s.back)}) · PVR ${money(s.pvr)} — into the month archive. The board itself is NOT cleared (it's a recomputable snapshot). Confirm with the user, then call close_month again with confirm=true.`;
  }
  const snapshot = buildClosedMonth(deals, ctx.viewer.employeeName || "EILA");
  await guardedMutate<ClosedMonth[]>(supabase, ctx.orgId, "closedMonths", (current) => {
    const existing = Array.isArray(current) ? current : [];
    return upsertClosedMonth(existing, snapshot);
  });
  return `Done — ${snapshot.monthLabel} archived (${snapshot.summary.delivered} units · ${money(snapshot.summary.gross)} gross). Pull it up anytime with read_archive.`;
}

// update_deal — edit an EXISTING deal's operational fields (stage, RDR punch,
// desk/finance manager) and, for a manager correcting a number, front/back gross
// (finite-guarded so a bad value can't write NaN). Admin/Manager/F&I only. Does
// NOT create deals — that stays a screen action to protect the money math.
async function handleUpdateDeal(input: any, ctx: EILAContext): Promise<string> {
  if (!canDeskWrite(ctx.viewer.role)) return "Editing a deal is a manager/F&I/admin move.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "The store isn't connected, so I can't save that right now.";
  const deals0: any[] = Array.isArray(ctx.data.deals) ? ctx.data.deals : [];
  const q = String(input?.deal || input?.dealNumber || "").trim().toLowerCase();
  if (!q) return "Which deal? Give me a deal number, stock number, or customer name.";
  const find = (list: any[]) =>
    list.find((d) => String(d.dealNumber || "").trim().toLowerCase() === q) ||
    list.find((d) => String(d.stockNumber || "").trim().toLowerCase() === q) ||
    list.find((d) => String(d.id || "").trim().toLowerCase() === q) ||
    list.find((d) => String(d.customer || "").toLowerCase().includes(q));
  const d0 = find(deals0);
  if (!d0) return `No deal matching "${String(input?.deal || input?.dealNumber)}" on the board.`;
  const id = d0.id;

  const updates: Record<string, any> = {};
  const VALID_STAGE = ["Desk", "Contracted", "Funded", "Delivered"];
  const VALID_RDR = ["Not Punched", "Pending", "Punched"];
  if (typeof input.stage === "string" && VALID_STAGE.includes(input.stage)) updates.stage = input.stage;
  if (typeof input.rdrStatus === "string" && VALID_RDR.includes(input.rdrStatus)) updates.rdrStatus = input.rdrStatus;
  if (typeof input.deskManager === "string" && input.deskManager.trim()) updates.deskManager = input.deskManager.trim();
  if (typeof input.financeManager === "string" && input.financeManager.trim()) updates.financeManager = input.financeManager.trim();
  const front = finiteOrUndef(input.frontGross);
  const back = finiteOrUndef(input.backGrossReserve);
  if (front !== undefined) updates.frontGross = front;
  if (back !== undefined) updates.backGrossReserve = back;
  if (!Object.keys(updates).length) return "Nothing to change — I can set stage, RDR status (Not Punched/Pending/Punched), the desk or finance manager, or correct front/back gross.";
  // Preview-then-commit: show the exact edit before it lands so an injected
  // instruction can't silently mutate a deal's money/stage (SOC 2 CC6.8/PI1.x).
  if (input?.confirm !== true) {
    const preview = Object.entries(updates).map(([k, v]) => `${k} → ${v}`).join(", ");
    return `About to update ${d0.customer || `deal ${d0.dealNumber || id}`}: ${preview}. Confirm with the user, then call update_deal again with confirm=true.`;
  }

  let savedName = d0.customer;
  try {
    await guardedMutate<any[]>(supabase, ctx.orgId, "deals", (current) => {
      const list = Array.isArray(current) ? current : [];
      const i = list.findIndex((x) => x && x.id === id);
      if (i < 0) return list;
      savedName = list[i].customer;
      list[i] = { ...list[i], ...updates };
      return list;
    });
  } catch {
    return "Something went wrong saving that — nothing was changed. Try again.";
  }
  return `Done — updated ${savedName || "the deal"} (${Object.keys(updates).join(", ")}).`;
}

// service_update — advance a service visit's status (Scheduled → Checked In → In
// Service → Ready → Picked Up) via the tested moveVisitPatch. Admin/Manager/F&I.
async function handleServiceUpdate(input: any, ctx: EILAContext): Promise<string> {
  if (!canDeskWrite(ctx.viewer.role)) return "Moving the service lane is a manager/F&I/admin move.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "The store isn't connected, so I can't update the lane right now.";
  const visits0: any[] = Array.isArray((ctx.data as any).serviceLane) ? (ctx.data as any).serviceLane : [];
  const id = String(input?.visitId || input?.id || "").trim();
  const status = String(input?.status || "").trim() as ServiceStatus;
  const VALID: ServiceStatus[] = ["Scheduled", "Checked In", "In Service", "Ready", "Picked Up"];
  if (!id) return "Which visit? Give me the visit id (from service_lane, e.g. SVC-…).";
  if (!VALID.includes(status)) return `Set the status to one of: ${VALID.join(", ")}.`;
  const v0 = visits0.find((v) => v && v.id === id);
  if (!v0) return `No service visit with id ${id} in the lane.`;
  if (moveVisitPatch(v0, status) === null) return `That visit is already ${status}.`;
  let who = v0.customer;
  await guardedMutate<any[]>(supabase, ctx.orgId, "serviceLane", (current) => {
    const list = Array.isArray(current) ? current : [];
    const i = list.findIndex((v) => v && v.id === id);
    if (i < 0) return list;
    who = list[i].customer;
    const patch = moveVisitPatch(list[i], status);
    if (patch) list[i] = { ...list[i], ...patch };
    return list;
  });
  return `Done — ${who || "that visit"} moved to ${status}.`;
}

// parts_update — advance a special order's status (Ordered → Received → Notified
// → Picked Up) via the tested moveSopPatch. Admin/Manager/F&I.
async function handlePartsUpdate(input: any, ctx: EILAContext): Promise<string> {
  if (!canDeskWrite(ctx.viewer.role)) return "Moving the parts counter is a manager/F&I/admin move.";
  const supabase = getSupabaseServerClient();
  if (!supabase) return "The store isn't connected, so I can't update parts right now.";
  const id = String(input?.sopId || input?.id || "").trim();
  const status = String(input?.status || "").trim() as SopStatus;
  const VALID: SopStatus[] = ["Ordered", "Received", "Notified", "Picked Up", "Returned"];
  if (!id) return "Which special order? Give me its id (from parts_counter, e.g. SOP-…).";
  if (!VALID.includes(status)) return `Set the status to one of: ${VALID.join(", ")}.`;
  const data0 = normalizePartsData((ctx.data as any).partsCounter);
  const s0 = data0.sops.find((s) => s && s.id === id);
  if (!s0) return `No special order with id ${id} on the counter.`;
  if (moveSopPatch(s0, status) === null) return `That order is already ${status}.`;
  let label = s0.partNumber || s0.customer;
  await guardedMutate<any>(supabase, ctx.orgId, "partsCounter", (current) => {
    const data = normalizePartsData(current);
    const i = data.sops.findIndex((s) => s && s.id === id);
    if (i < 0) return data;
    label = data.sops[i].partNumber || data.sops[i].customer;
    const patch = moveSopPatch(data.sops[i], status);
    if (patch) data.sops[i] = { ...data.sops[i], ...patch };
    return data;
  });
  return `Done — special order ${label || id} moved to ${status}.`;
}

const RESTORE_BACKUP_TOOL = {
  name: "restore_backup",
  description:
    "Restore the store's safety-net deals backup (snapshotted automatically before any import that replaces the board) — the same restore as the Import screen. DESTRUCTIVE: replaces the current board. ALWAYS call it once WITHOUT confirm first to see what the backup holds, tell the user, and only call with confirm=true after they explicitly agree. Manager/F&I/Admin only.",
  input_schema: {
    type: "object",
    properties: { confirm: { type: "boolean", description: "true ONLY after the user has explicitly confirmed the restore" } },
  },
};

const DECODE_VIN_TOOL = {
  name: "decode_vin",
  description:
    "Decode a 17-character VIN through NHTSA — year, make, model, trim, body, engine — and cross-check whether that VIN is on one of this store's deals or working leads. Use whenever anyone gives you a VIN ('what is this VIN', 'run this VIN', 'whose car is JM3...').",
  input_schema: {
    type: "object",
    properties: { vin: { type: "string", description: "The 17-character VIN" } },
    required: ["vin"],
  },
};

const REMEMBER_TOOL = {
  name: "remember_rep",
  description:
    "Save a lasting coaching observation about a salesperson or F&I manager to your persistent memory so it survives across conversations. Use this whenever you notice a strength, a weakness, or a recurring pattern worth remembering to coach this person better over time.",
  input_schema: {
    type: "object",
    properties: {
      rep: { type: "string", description: "Full name of the salesperson / F&I manager" },
      strengths: { type: "array", items: { type: "string" }, description: "Strengths to remember" },
      weaknesses: { type: "array", items: { type: "string" }, description: "Weak points / areas to improve" },
      patterns: { type: "array", items: { type: "string" }, description: "Behavioral or performance patterns noticed" },
      note: { type: "string", description: "Any other coaching note worth keeping" },
      drill: { type: "string", description: "A specific word track / rebuttal you're assigning this rep to practice, tied to a weakness (e.g. 'Practice the Feel-Felt-Found rebuttal for payment objections — run it 10x')." },
      personality: { type: "string", description: "This rep's personality / how they best take a push — so you coach them the way that lands (e.g. 'competitive hard-charger, responds to challenge' vs 'sensitive, rebuilding confidence, needs encouragement first')." },
      motivation: { type: "string", description: "Where they're at in life and their real 'why' — what they're working toward (e.g. 'new baby, saving for a house, money-motivated this quarter')." },
    },
    required: ["rep"],
  },
};

const REMEMBER_CUSTOMER_TOOL = {
  name: "remember_customer",
  description:
    "Save what you've learned about a specific CUSTOMER to your persistent memory so it survives across conversations — what they want, their objections, their situation, how they like to be handled. Use it whenever you learn something about a customer worth remembering to help close them and never restart cold.",
  input_schema: {
    type: "object",
    properties: {
      customer: { type: "string", description: "The customer's name (or lead id)" },
      wants: { type: "array", items: { type: "string" }, description: "What they want — vehicle, payment, features, timing" },
      objections: { type: "array", items: { type: "string" }, description: "Objections / hesitations they've raised" },
      context: { type: "array", items: { type: "string" }, description: "Life/situation context — family, trade, credit, why they're buying" },
      note: { type: "string", description: "Any other detail worth keeping about this customer" },
    },
    required: ["customer"],
  },
};

const REMEMBER_PATTERN_TOOL = {
  name: "remember_pattern",
  description:
    "Save a high-order PATTERN you've learned about THIS store/floor to your store playbook — what converts, what objections recur and the word track that beats them, what the best closers do, timing/source trends. This is how you get smarter every deal. Use it whenever you spot a repeatable lesson about this dealership.",
  input_schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The pattern / lesson, stated concisely and actionably (e.g. 'Payment objections on used SUVs land best reframing to cost-of-ownership per day')." },
    },
    required: ["pattern"],
  },
};

const REMEMBER_MISTAKE_TOOL = {
  name: "remember_mistake",
  description:
    "Log a MISTAKE — made by ANYONE (a salesperson, an F&I manager, the store, or YOURSELF when you get something wrong and are corrected) — to your permanent memory, WITH the warning sign to watch for and the fix, so you CATCH it before it ever happens again and never make it yourself. Use it for any mistake, miss, or error: a missed product, a wrong tax/fee, a structure error, a compliance miss, a negative gross, a missing doc, a blown follow-up — anything that cost money, time, or created risk. Learn from every mistake so the store (and you) only ever pay for it once.",
  input_schema: {
    type: "object",
    properties: {
      mistake: { type: "string", description: "What went wrong, concretely (e.g. 'GAP sold on an 84-month deal at 145% LTV — would never have funded')." },
      sign: { type: "string", description: "The warning SIGN / setup that signals this mistake is about to repeat, specific enough to match a future deal (e.g. 'term >= 75mo AND GAP added AND LTV > 130%')." },
      fix: { type: "string", description: "How to catch / prevent it next time — the correct move." },
      deal: { type: "string", description: "The deal it happened on (customer or id), optional." },
    },
    required: ["mistake"],
  },
};

// The Dealer Mission OS assistant runs on Claude Opus 4.8 — the most capable model — so
// the coaching reasons at the top tier (deal strategy, objection handling,
// next-best-action). Tier down to claude-haiku-4-5 only for high-frequency,
// low-reasoning calls if cost becomes a concern.
const ASSISTANT_MODEL = "claude-opus-4-8";

// Call Anthropic with retry on transient errors (429 / 5xx / 529 overloaded) so
// a one-off blip never surfaces to the floor. Throws only after retries fail.
async function anthropicFetch(apiKey: string, body: Record<string, any>, tries = 3): Promise<any> {
  let lastErr = "";
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    lastErr = `Anthropic error ${res.status}: ${await res.text()}`;
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retryable || attempt === tries - 1) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); // 0.5s, 1s backoff
  }
  throw new Error(lastErr || "Anthropic error: request failed");
}

async function callClaude(
  systemBase: string,
  messages: { role: "user" | "assistant"; content: string }[],
  maxTokens = 700,
  extraSystem?: string,
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // Prompt caching: systemBase (EILA core + dealer layer + store economics) is
  // identical across the single-shot actions (drafts, health checks, briefs),
  // so a breakpoint on it means back-to-back actions within 5 minutes re-read
  // it at ~0.1x. extraSystem varies per lead/action, so it stays uncached.
  const data = await anthropicFetch(apiKey, {
    model: ASSISTANT_MODEL,
    max_tokens: maxTokens,
    system: [
      { type: "text", text: systemBase, cache_control: { type: "ephemeral" } },
      ...(extraSystem ? [{ type: "text", text: extraSystem }] : []),
    ],
    messages,
  });
  const block = data.content?.[0];
  return block?.type === "text" ? (block.text as string) : "";
}

// The full tool surface EILA carries into every chat turn. Defined once so the
// buffered path and the streaming path can never drift apart.
const SET_GOALS_TOOL = {
  name: "set_goals",
  description: "Set the store's targets or a rep's goal — actually save it (mirrors the Goals screen). Set a team delivered-unit goal, a store total-PVR goal, and/or one rep's unit goal (with their name). Manager/Admin only. TWO-STEP: call WITHOUT confirm first to preview, then only call with confirm=true after the user explicitly approves.",
  input_schema: {
    type: "object",
    properties: {
      teamDeliveredUnits: { type: "number", description: "Store's monthly delivered-unit target." },
      pvrTotal: { type: "number", description: "Store's total-PVR (per-vehicle gross) target in dollars." },
      rep: { type: "string", description: "A salesperson's name, to set their personal unit goal." },
      repUnits: { type: "number", description: "That rep's monthly unit goal (requires 'rep')." },
      confirm: { type: "boolean", description: "true ONLY after the user explicitly approved the previewed goals." },
    },
  },
};
const CLOSE_MONTH_TOOL = {
  name: "close_month",
  description: "Archive the current board into the month archive (later read with read_archive). Manager/Admin only. TWO-STEP: call WITHOUT confirm first to show what will be archived, tell the user, and only call with confirm=true after they agree. Non-destructive — the board is not cleared.",
  input_schema: { type: "object", properties: { confirm: { type: "boolean", description: "true ONLY after the user explicitly confirmed closing the month." } } },
};
const UPDATE_DEAL_TOOL = {
  name: "update_deal",
  description: "Take ACTION on an existing deal — save the change, don't just suggest it (mirrors Deal Center / RDR / Desk). Find the deal by deal number, stock number, or customer name, then set its stage (Desk/Contracted/Funded/Delivered), punch its RDR status (Not Punched/Pending/Punched), reassign the desk or finance manager, or correct front/back gross. Manager/F&I/Admin only. Does NOT create new deals. TWO-STEP: call WITHOUT confirm first to preview the exact edit, then only call with confirm=true after the user explicitly approves — never confirm on your own.",
  input_schema: {
    type: "object",
    properties: {
      deal: { type: "string", description: "Which deal — a deal number, stock number, or customer name." },
      stage: { type: "string", enum: ["Desk", "Contracted", "Funded", "Delivered"], description: "New deal stage." },
      rdrStatus: { type: "string", enum: ["Not Punched", "Pending", "Punched"], description: "RDR punch status." },
      deskManager: { type: "string", description: "Desk manager to assign." },
      financeManager: { type: "string", description: "F&I manager to assign." },
      frontGross: { type: "number", description: "Corrected front gross (dollars) — only for a real correction." },
      backGrossReserve: { type: "number", description: "Corrected back gross/reserve (dollars) — only for a real correction." },
      confirm: { type: "boolean", description: "true ONLY after the user explicitly approved the previewed edit." },
    },
    required: ["deal"],
  },
};
const SERVICE_UPDATE_TOOL = {
  name: "service_update",
  description: "Advance a service visit's status (Scheduled → Checked In → In Service → Ready → Picked Up) — mirrors the Service Lane screen. Get the visit id from service_lane first. Manager/F&I/Admin only.",
  input_schema: {
    type: "object",
    properties: {
      visitId: { type: "string", description: "The visit id from service_lane (e.g. SVC-…)." },
      status: { type: "string", enum: ["Scheduled", "Checked In", "In Service", "Ready", "Picked Up"], description: "New status." },
    },
    required: ["visitId", "status"],
  },
};
const PARTS_UPDATE_TOOL = {
  name: "parts_update",
  description: "Advance a parts special order's status (Ordered → Received → Notified → Picked Up, or Returned) — mirrors the Parts Counter screen. Get the order id from parts_counter first. Manager/F&I/Admin only.",
  input_schema: {
    type: "object",
    properties: {
      sopId: { type: "string", description: "The special-order id from parts_counter (e.g. SOP-…)." },
      status: { type: "string", enum: ["Ordered", "Received", "Notified", "Picked Up", "Returned"], description: "New status." },
    },
    required: ["sopId", "status"],
  },
};

const EILA_TOOLS = [QUERY_DEALS_TOOL, DEAL_JACKET_TOOL, REP_DETAIL_TOOL, ESTIMATE_PAY_TOOL, NEXT_LEADS_TOOL, APPOINTMENTS_TOOL, EQUITY_TOOL, AT_RISK_TOOL, READ_ARCHIVE_TOOL, UPDATE_LEAD_TOOL, UPDATE_DEAL_TOOL, SET_GOALS_TOOL, CLOSE_MONTH_TOOL, SERVICE_UPDATE_TOOL, PARTS_UPDATE_TOOL, LOOKUP_RATE_TOOL, DECODE_VIN_TOOL, SPEED_TO_LEAD_TOOL, CHECK_CONSENT_TOOL, GROUP_REPORT_TOOL, SERVICE_LANE_TOOL, PARTS_COUNTER_TOOL, FIXED_OPS_DIGEST_TOOL, TEXT_CUSTOMER_TOOL, RESTORE_BACKUP_TOOL, REMEMBER_TOOL, REMEMBER_CUSTOMER_TOOL, REMEMBER_PATTERN_TOOL, REMEMBER_MISTAKE_TOOL];

// Run every tool_use block in a model turn against the live store and return the
// tool_result blocks to feed back. Shared by the buffered and streaming loops so
// there is exactly one dispatch table. Appends each fired tool name to
// `toolsUsed` (for the UI "working" chip). A single tool throwing degrades to a
// tool error string — it never takes down the turn.
async function runToolCalls(content: any[], ctx: EILAContext, toolsUsed: string[]): Promise<any[]> {
  const results: any[] = [];
  for (const b of content || []) {
    if (b.type !== "tool_use") continue;
    toolsUsed.push(b.name);
    let out = "Unknown tool.";
    try {
      if (b.name === "query_deals") out = handleQueryDeals(b.input, ctx);
      else if (b.name === "deal_jacket") out = handleDealJacket(b.input, ctx);
      else if (b.name === "rep_detail") out = handleRepDetail(b.input, ctx);
      else if (b.name === "estimate_pay") out = handleEstimatePay(b.input, ctx);
      else if (b.name === "next_leads") out = handleNextLeads(b.input, ctx);
      else if (b.name === "appointments") out = handleAppointments(b.input, ctx);
      else if (b.name === "equity") out = handleEquity(b.input, ctx);
      else if (b.name === "deals_at_risk") out = handleDealsAtRisk(b.input, ctx);
      else if (b.name === "read_archive") out = handleReadArchive(b.input, ctx);
      else if (b.name === "update_lead") out = await handleUpdateLead(b.input, ctx);
      else if (b.name === "update_deal") out = await handleUpdateDeal(b.input, ctx);
      else if (b.name === "set_goals") out = await handleSetGoals(b.input, ctx);
      else if (b.name === "close_month") out = await handleCloseMonth(b.input, ctx);
      else if (b.name === "service_update") out = await handleServiceUpdate(b.input, ctx);
      else if (b.name === "parts_update") out = await handlePartsUpdate(b.input, ctx);
      else if (b.name === "lookup_rate") out = handleLookupRate(b.input, ctx);
      else if (b.name === "decode_vin") out = await handleDecodeVin(b.input, ctx);
      else if (b.name === "speed_to_lead") out = handleSpeedToLead(b.input, ctx);
      else if (b.name === "check_consent") out = handleCheckConsent(b.input, ctx);
      else if (b.name === "group_report") out = await handleGroupReport(b.input, ctx);
      else if (b.name === "service_lane") out = handleServiceLane(b.input, ctx);
      else if (b.name === "parts_counter") out = handlePartsCounter(b.input, ctx);
      else if (b.name === "fixed_ops_digest") out = handleFixedOpsDigest(b.input, ctx);
      else if (b.name === "text_customer") out = await handleTextCustomer(b.input, ctx);
      else if (b.name === "restore_backup") out = await handleRestoreBackup(b.input, ctx);
      else if (b.name === "remember_rep") out = await saveRepObservation(b.input, ctx.orgId);
      else if (b.name === "remember_customer") out = await saveCustomerObservation(b.input, ctx.orgId);
      else if (b.name === "remember_pattern") out = await savePatternObservation(b.input, ctx.orgId);
      else if (b.name === "remember_mistake") out = await saveMistakeObservation(b.input, ctx.orgId);
    } catch (e) {
      out = `Tool error: ${e instanceof Error ? e.message : "failed"}`;
    }
    results.push({ type: "tool_result", tool_use_id: b.id, content: out });
  }
  return results;
}

// Chat path with EILA's memory tool — runs the tool loop so she can save
// coaching observations mid-conversation and then answer.
async function callEILAChat(
  systemBase: string,
  ctx: EILAContext,
  messages: any[],
  maxTokens: number,
  extraSystem: string,
): Promise<{ text: string; tools: string[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const toolsUsed: string[] = []; // which tools EILA fired, for the UI "working" chip

  // Prompt caching: split the system into a STABLE block (EILA's core + the
  // Dealer layer + the sales playbook + this store's economics — identical on
  // every message of a user's session, ~11.5K tokens) and the VOLATILE store
  // snapshot. Each gets a cache breakpoint, so Anthropic re-reads them at
  // ~0.1x instead of full price on every turn. The stable block embeds the
  // caller's name (the core addresses the rep by name), so it caches per USER
  // across their turns rather than store-wide; the snapshot is reused across
  // turns within a session. Tools render before system, so the first
  // breakpoint caches the tool definitions too. Same model, same output —
  // this is a cost change, not a behavior change. (Verify via the cache_read
  // line logged below on the preview.)
  const stableSystem = `${systemBase}${COACHING_PROMPT}`;
  const system: any[] = [{ type: "text", text: stableSystem, cache_control: { type: "ephemeral" } }];
  if (extraSystem) system.push({ type: "text", text: extraSystem, cache_control: { type: "ephemeral" } });

  let msgs = [...messages];
  // Up to 6 turns so EILA can chain tool calls (query → query again → answer).
  for (let iter = 0; iter < 6; iter++) {
    // Adaptive thinking: EILA reasons as hard as the question deserves — deep on
    // deal structuring / audits / objections, barely at all on a quick lookup.
    // The visible reply stays tight (the prompt enforces it); the reasoning is
    // internal. "medium" effort keeps him snappy; max_tokens 4000 leaves
    // headroom for thinking + a full answer. Retries transient errors.
    const data = await anthropicFetch(apiKey, {
      model: ASSISTANT_MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // Top-level cache_control auto-marks the LAST block in the request — the
      // newest message / tool result — so the conversation itself is cached
      // too: each tool-loop round and each follow-up turn re-reads the prior
      // exchange at ~0.1x instead of reprocessing it. If the auto breakpoint's
      // lookback misses (long tool round), the explicit system breakpoints
      // above still catch, so a miss never costs more than today's baseline.
      cache_control: { type: "ephemeral" },
      system,
      tools: EILA_TOOLS,
      messages: msgs,
    });
    if (data.usage) {
      const u = data.usage;
      console.log(`[AI/CRM] cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0}`);
    }
    if (data.stop_reason === "tool_use") {
      msgs.push({ role: "assistant", content: data.content });
      const results = await runToolCalls(data.content, ctx, toolsUsed);
      msgs.push({ role: "user", content: results });
      continue;
    }
    const textBlock = (data.content || []).find((b: any) => b.type === "text");
    return { text: textBlock?.text || "", tools: Array.from(new Set(toolsUsed)) };
  }
  return { text: "Done.", tools: Array.from(new Set(toolsUsed)) };
}

// Open a streaming Anthropic request. Retries the CONNECT on transient errors
// (429 / 5xx / 529) the same way anthropicFetch does — but only before any bytes
// are streamed, so a retry never double-emits tokens. Returns the live body.
async function anthropicFetchStream(apiKey: string, body: Record<string, any>, tries = 3, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  let lastErr = "";
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
    if (res.ok && res.body) return res.body;
    lastErr = `Anthropic error ${res.status}: ${await res.text().catch(() => "")}`;
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retryable || attempt === tries - 1) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(lastErr || "Anthropic stream error: request failed");
}

// Streaming twin of callEILAChat: same system, same tools, same 6-turn loop, but
// each turn streams. `onEvent` forwards EILA's text deltas and tool activity to
// the client the instant they arrive, so she talks as she thinks. Returns the
// full assembled reply + tools fired, for memory reflection after the stream.
async function streamEILAChat(
  systemBase: string,
  ctx: EILAContext,
  messages: any[],
  maxTokens: number,
  extraSystem: string,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<{ text: string; tools: string[]; aborted: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const toolsUsed: string[] = [];

  const stableSystem = `${systemBase}${COACHING_PROMPT}`;
  const system: any[] = [{ type: "text", text: stableSystem, cache_control: { type: "ephemeral" } }];
  if (extraSystem) system.push({ type: "text", text: extraSystem, cache_control: { type: "ephemeral" } });

  let fullText = "";
  let msgs = [...messages];
  for (let iter = 0; iter < 6; iter++) {
    // If the client went away mid-stream, stop the loop — don't keep burning
    // model calls and tool side-effects for an abandoned request.
    if (signal?.aborted) return { text: fullText, tools: Array.from(new Set(toolsUsed)), aborted: true };
    const stream = await anthropicFetchStream(apiKey, {
      model: ASSISTANT_MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      system,
      tools: EILA_TOOLS,
      messages: msgs,
    }, 3, signal);
    // Assemble the turn while forwarding text + tool events to the client.
    const assembled = await assembleAnthropicStream(stream, (e) => {
      if (e.type === "text") fullText += e.text;
      onEvent(e);
    });
    if (assembled.usage) {
      const u = assembled.usage;
      console.log(`[AI/CRM stream] cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0}`);
    }
    if (assembled.stop_reason === "tool_use") {
      msgs.push({ role: "assistant", content: assembled.content });
      const results = await runToolCalls(assembled.content, ctx, toolsUsed);
      msgs.push({ role: "user", content: results });
      continue;
    }
    break; // end_turn (or any non-tool stop) — the streamed text is the reply.
  }
  // If the loop exhausted its turns still wanting tools (no concluding text),
  // emit the same fallback the buffered path returns so the reply is never empty.
  if (!fullText.trim()) {
    const done = "Done.";
    fullText = done;
    onEvent({ type: "text", text: done });
  }
  return { text: fullText, tools: Array.from(new Set(toolsUsed)), aborted: false };
}

// SECURITY: the per-lead actions (health-check / draft-followup / next-action /
// first chat turn) must NOT trust the lead object from the request body — a rep
// could POST another rep's customer. Resolve the lead from the store by id and
// enforce the same rule as the store API: a Sales user may only act on their OWN
// leads. Managers/F&I/BDC/Admin/owner may act on any lead in their store.
async function resolveLead(
  orgId: string,
  viewer: Viewer,
  clientLead: Record<string, any> | undefined,
): Promise<{ lead: Record<string, any> | null; denied: boolean }> {
  if (!clientLead) return { lead: null, denied: false };
  const supabase = getSupabaseServerClient();
  if (!supabase) return { lead: clientLead, denied: false }; // dev only
  let stored: Record<string, any> | null = null;
  if (clientLead.id) {
    const { data } = await supabase.from("app_store").select("value").eq("org_id", orgId).eq("key", "crmLeads").maybeSingle();
    const leads: any[] = Array.isArray(data?.value) ? data!.value : [];
    stored = leads.find((l) => l.id === clientLead.id) || null;
  }
  if (viewer.role === "Sales") {
    if (!stored || !samePerson(stored.salesperson, viewer.employeeName)) return { lead: null, denied: true };
    return { lead: stored, denied: false };
  }
  // Non-Sales roles can see the whole store; prefer the authoritative stored copy.
  return { lead: stored || clientLead, denied: false };
}

export async function POST(req: Request) {
  try {
    const { ok, orgId, settings, viewer } = await resolveCaller(req);
    if (!ok) {
      return NextResponse.json(
        { error: "The Dealer Mission OS Assistant isn't enabled for your store. Ask your admin to turn it on in Store Settings." },
        { status: 403 },
      );
    }

    // Keyed per USER within the org — one heavy user gets throttled without
    // starving the rest of the floor (an org-only key bucketed the whole store).
    const rl = await rateLimit(clientKey(req, `${orgId}:${viewer.employeeName || "anon"}`), { limit: 40, windowSec: 60 });
    if (!rl.ok) return tooManyRequests(rl);

    // EILA on every action = the canonical core (who she is, everywhere) + the
    // Dealer capability layer (what she does here) + THIS store's economics.
    const systemBase = `${ilaCore(viewer.employeeName || "this team")}\n\n${DEALER_PROMPT}\n\n${storeContext(settings)}`;

    // EILA's memory, two tiers, both consumed on every action and both living
    // in the VOLATILE prompt block so the stable block's per-session prompt
    // cache is untouched:
    //  - per-rep memory: what she's learned about THIS person (new notes are
    //    distilled after chat turns — see reflectUserMemory below)
    //  - the main brain: universal craft lessons shared by every C41 product
    const [repNotes, brainLessons] = await Promise.all([
      loadUserMemory(orgId, viewer.employeeName),
      loadBrainLessons(),
    ]);
    const userMemory = [renderUserMemory(repNotes), renderBrain(brainLessons)]
      .filter(Boolean)
      .join("\n\n");

    const body = await req.json() as Record<string, any>;
    const { action, lead, message, history = [], channel = "text" } = body;

    // Never render a client-supplied lead unchecked — resolve + authorize it.
    const { lead: safeLead, denied } = await resolveLead(orgId, viewer, lead);
    if (denied) {
      return NextResponse.json(
        { error: "You can only use the assistant on your own leads." },
        { status: 403 },
      );
    }
    const leadCtx = safeLead ? leadToContext(safeLead) : "";

    if (action === "next-action") {
      const text = await callClaude(
        systemBase,
        [{ role: "user", content: `${leadCtx}\n\nWhat is the single best next action for this lead RIGHT NOW? Give one specific, immediately actionable recommendation in 1–2 sentences. No bullet points, no preamble.` }],
        120,
        userMemory || undefined,
      );
      return NextResponse.json({ suggestion: text });
    }

    if (action === "health-check") {
      const text = await callClaude(
        systemBase,
        [{
          role: "user",
          content: `${leadCtx}\n\nAnalyze this lead's health and buying likelihood. Return ONLY valid JSON, no markdown:
{
  "score": <number 1-10>,
  "label": "<Hot|Warm|Cool|Cold>",
  "summary": "<one sentence on deal health>",
  "flags": ["<risk or positive observation>"],
  "recommendation": "<top priority action in one sentence>"
}`,
        }],
        280,
        userMemory || undefined,
      );
      try {
        const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
        const health = JSON.parse(cleaned);
        return NextResponse.json({ health });
      } catch {
        return NextResponse.json({
          health: { score: 5, label: "Warm", summary: text, flags: [], recommendation: "" },
        });
      }
    }

    if (action === "draft-followup") {
      const isEmail = channel === "email";
      // firstTouch: the speed-to-lead intro on a fresh up — a different job
      // than a follow-up. First words the customer ever gets from the store,
      // racing the 5:00 clock: introduce the rep by name, hook to exactly
      // what they asked about, end on one easy question. Never mention that
      // it's AI-written, never sound like a dealership blast.
      const instruction = body?.firstTouch
        ? `Draft the FIRST text message this brand-new lead will ever receive from ${viewer.employeeName || "the rep"} at this store. Two sentences max, under 280 characters. Open with their first name, introduce the sender by first name and store, reference the exact vehicle or request they came in on, and end with ONE easy low-pressure question that moves toward a visit. Warm, human, specific — zero dealer-speak, no exclamation-point pile-ups, no "great news!". Return ONLY the message text.`
        : `Draft a short, personalized ${isEmail ? "email (include a subject line)" : "text message (max 3 sentences)"} follow-up for this customer. Sound human and specific to their situation — no generic dealer-speak.`;
      const text = await callClaude(
        systemBase,
        [{ role: "user", content: `${leadCtx}\n\n${instruction}` }],
        isEmail ? 220 : 140,
        userMemory || undefined,
      );
      return NextResponse.json({ draft: text });
    }

    if (action === "chat") {
      // Coalesce consecutive same-role turns and drop blanks before they reach
      // the Messages API, which rejects two messages of the same role in a row.
      // A client that (e.g.) ended a turn with a partial+error assistant bubble
      // must never brick the next request.
      const prior: { role: "user" | "assistant"; content: string }[] = [];
      for (const m of (history || [])) {
        const role = (m?.role === "assistant" ? "assistant" : "user") as "user" | "assistant";
        const content = String(m?.content ?? "").trim();
        if (!content) continue;
        const last = prior[prior.length - 1];
        if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
        else prior.push({ role, content });
      }
      const userContent = prior.length === 0
        ? `${leadCtx}\n\nQuestion: ${message}`
        : message;

      // EILA gets this store's full live dataset on every chat turn so she can
      // answer anything and audit the deals.
      // Load the store data ONCE: it backs both the capped text snapshot and
      // EILA's live-query tools (which run over it with no extra DB calls).
      const data = await loadStoreData(orgId);
      const snapshot = buildSnapshot(data, settings, viewer);
      const ctx: EILAContext = { orgId, settings, viewer, data };
      // Append the new user turn, merging if prior already ends on a user turn
      // (keeps roles strictly alternating for the Messages API).
      const messages: any[] = [...prior];
      const lastPrior = messages[messages.length - 1];
      if (lastPrior && lastPrior.role === "user") {
        messages[messages.length - 1] = { role: "user", content: `${lastPrior.content}\n\n${userContent}` };
      } else {
        messages.push({ role: "user", content: userContent });
      }
      // 4000 leaves room for adaptive thinking + a full answer; the prompt keeps
      // the visible reply short, so this is headroom for reasoning, not length.
      const extraSystem = userMemory ? `${snapshot}\n\n${userMemory}` : snapshot;

      // Distill durable per-rep notes after the reply is settled (waitUntil keeps
      // the function alive on Vercel; a failed reflection never disturbs chat).
      // Shared by both the streaming and buffered paths.
      const reflect = (replyText: string) => {
        if (replyText.trim() && viewer.employeeName.trim()) {
          waitUntil(reflectUserMemory(orgId, viewer.employeeName, [
            ...prior,
            { role: "user", content: String(message ?? "") },
            { role: "assistant", content: replyText },
          ]));
        }
      };

      // Streaming path (opt-in via { stream: true }): EILA talks as she thinks.
      // Emits newline-delimited JSON events — {t:"token"|"tool"|"done"|"error"}.
      // Backward-compatible: callers that don't ask for a stream get the JSON
      // reply below, unchanged.
      if (body?.stream === true) {
        const encoder = new TextEncoder();
        const signal = req.signal;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let closed = false;
            // Guard every enqueue: if the client already left, the controller is
            // closed/errored and enqueue throws — swallow it instead of crashing
            // the whole handler (and re-throwing inside the catch below).
            const send = (obj: Record<string, unknown>) => {
              if (closed || signal.aborted) return;
              try {
                controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
              } catch {
                closed = true;
              }
            };
            try {
              const result = await streamEILAChat(systemBase, ctx, messages, 4000, extraSystem, (e) => {
                if (e.type === "text") send({ t: "token", v: e.text });
                else if (e.type === "tool") send({ t: "tool", v: e.name });
              }, signal);
              if (!result.aborted) {
                send({ t: "done", tools: result.tools });
                reflect(result.text); // only learn from a reply the user actually received
              }
            } catch (err) {
              if (!signal.aborted) {
                const msg = err instanceof Error ? err.message : "Something went wrong.";
                send({ t: "error", v: msg });
              }
            } finally {
              closed = true;
              try { controller.close(); } catch { /* already closed by an abort */ }
            }
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            "x-accel-buffering": "no",
          },
        });
      }

      const result = await callEILAChat(systemBase, ctx, messages, 4000, extraSystem);
      reflect(result.text);
      return NextResponse.json({ reply: result.text, tools: result.tools });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[AI/CRM]", message);
    if (message.includes("ANTHROPIC_API_KEY not set")) {
      return NextResponse.json(
        { error: "Add ANTHROPIC_API_KEY to your Vercel environment variables and redeploy." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
