import { isOwnerEmail, normalizeAccessRole } from "@/lib/access";
import { orgEntitled } from "@/lib/billing";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { DEFAULT_ORG_ID } from "@/lib/orgs";
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
import { speedClock, speedStats } from "@/lib/speedToLead";
import { consentStatus, consentSummary, suppressionDeadline } from "@/lib/consent";
import { jacketOrderFor, jacketStatus, jacketSummaryLine } from "@/lib/dealJacket";
import { isLate, laneStats, promiseRisk, promiseStats, recaptureList, type ServiceStatus } from "@/lib/service";
import { SOP_AGING_DAYS, counterStats, normalizePartsData, sopAgeDays, stockSuggestions, type SopStatus } from "@/lib/parts";
import { buildClosedMonth, summarizeMonth, type ClosedMonth } from "@/lib/closeMonth";
import { buildFixedOpsDigest } from "@/lib/fixedOpsDigest";
import { groupForViewer, groupRollup, type GroupStoreInput } from "@/lib/groupReport";

export type Viewer = { role: string; employeeName: string; email?: string };
export type Caller = { ok: boolean; orgId: string; settings: StoreSettings; viewer: Viewer };
export type EILAData = Record<string, any>;
export type EILAContext = { orgId: string; settings: StoreSettings; viewer: Viewer; data: EILAData };

export const PUBLIC_VIEWER: Viewer = { role: "Admin", employeeName: "", email: "" };

export async function resolveCaller(req: Request): Promise<Caller> {
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

export function storeContext(s: StoreSettings): string {
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

export function leadToContext(lead: Record<string, any>): string {
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

// Pulls one store's raw Dealer Mission OS dataset ONCE (deals, team, goals, CRM leads,
// rep profiles, monthly setup). Used to BOTH build the capped text snapshot and
// back EILA's live-query tools — so the tools run over already-loaded data in
// memory with no extra database round-trips.
export async function loadStoreData(orgId: string): Promise<EILAData> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return {};
  const { data } = await supabase.from("app_store").select("key,value").eq("org_id", orgId).in("key", ["deals", "team", "goals", "crmLeads", "repProfiles", "monthlySetup", "customerMemory", "storeMemory", "mistakeMemory", "compPlans", "payplans", "serviceLane", "partsCounter", "closedMonths"]);
  return Object.fromEntries((data || []).map((r: any) => [r.key, r.value]));
}

// One deal rendered as a full raw-numbers line — the format EILA audits from.
// Shared by the snapshot and the query_deals tool so they never diverge.
export function dealLine(d: any, idx: number, settings: StoreSettings, who: string): string {
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
export function buildSnapshot(map: EILAData, settings: StoreSettings, viewer: Viewer): string {

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


// Scope leads based on viewer role — Sales sees only their own book,
// everyone else sees the whole store.
export function scopeLeads(leads: any[], viewer: Viewer): any[] {
  const ownOnly = viewer.role === "Sales";
  return ownOnly ? leads.filter((l) => samePerson(l.salesperson, viewer.employeeName)) : leads;
}
