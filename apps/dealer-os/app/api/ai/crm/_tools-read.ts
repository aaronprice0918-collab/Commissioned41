import type { EILAContext } from "./_context";
import { scopeLeads } from "./_context";
import {
  commissionableFrontGross,
  productUnits,
  manufacturerMoney,
  docFeeIncome,
  currency,
  samePerson,
  salespersonShare,
  isCountableFinance,
  productLabels,
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
import { dealLine } from "./_context";

const num = (v: any) => (Number.isFinite(+v) ? +v : 0);

// query_deals — drill the FULL deal list (uncapped) by rep / FM / stage / type /
// audit issue, returning matching deals with full numbers + a quick total.
export function handleQueryDeals(input: any, ctx: EILAContext): string {
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
export function handleDealJacket(input: any, ctx: EILAContext): string {
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

export function handleRepDetail(input: any, ctx: EILAContext): string {
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
export function handleEstimatePay(input: any, ctx: EILAContext): string {
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

// next_leads — who to work next, scored 0–100 for buying intent (same engine as
// the Follow-Up Center): overdue first, then hottest, with the recommended touch.
export function handleNextLeads(input: any, ctx: EILAContext): string {
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
export function handleAppointments(input: any, ctx: EILAContext): string {
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
export function handleEquity(input: any, ctx: EILAContext): string {
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
export function handleDealsAtRisk(_input: any, ctx: EILAContext): string {
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
export function handleReadArchive(input: any, ctx: EILAContext): string {
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

export const QUERY_DEALS_TOOL = {
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

export const DEAL_JACKET_TOOL = {
  name: "deal_jacket",
  description:
    "The deal-jacket checklist for ONE deal: the store's required document order plus what's already filed, what's N/A, and what's still missing from the physical file. Use it whenever an F&I manager or the office asks what order a deal file goes in, what's missing from a jacket, or whether a deal is ready to walk to the office. Look the deal up by deal number, customer name, or stock number.",
  input_schema: {
    type: "object",
    properties: { deal: { type: "string", description: "Deal number, customer name, or stock number" } },
    required: ["deal"],
  },
};

export const REP_DETAIL_TOOL = {
  name: "rep_detail",
  description:
    "Get the full picture on one salesperson or F&I manager: their sales and F&I numbers, their full deal list, and the coaching memory you've built on them. Use it whenever someone wants to go deep on a specific rep ('how is Bo doing', 'walk me through Daryl').",
  input_schema: {
    type: "object",
    properties: { name: { type: "string", description: "Full name of the rep / F&I manager" } },
    required: ["name"],
  },
};

export const ESTIMATE_PAY_TOOL = {
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

export const NEXT_LEADS_TOOL = {
  name: "next_leads",
  description:
    "The prioritized follow-up list — every open lead scored 0–100 for buying intent (same engine as the Follow-Up Center), overdue first, with the recommended next touch. Use for 'who should I work / call next', 'my hot leads', 'what's overdue', 'work the floor'. Reps get their own book; managers see everyone.",
  input_schema: { type: "object", properties: { filter: { type: "string", enum: ["all", "overdue", "hot"] }, limit: { type: "number" } } },
};

export const APPOINTMENTS_TOOL = {
  name: "appointments",
  description: "The appointment board: who's coming in today, who still needs a confirmation call, and passed/no-show appointments to reschedule. Use for 'appointments today', 'who do I need to confirm', 'any no-shows'.",
  input_schema: { type: "object", properties: {} },
};

export const EQUITY_TOOL = {
  name: "equity",
  description: "The trade-up radar: sold customers approaching lease maturity or in the 18–54 month ownership window — who to call about upgrading. Timing signals only (confirm exact equity at appraisal). Use for 'equity opportunities', 'who can I trade up', 'lease maturities'.",
  input_schema: { type: "object", properties: {} },
};

export const AT_RISK_TOOL = {
  name: "deals_at_risk",
  description: "Open deals stuck too long in a stage that should keep moving (desking/finance aging, working leads gone stale) — where a manager should step in before they slip. Use for 'what's at risk', 'stuck deals', 'what needs me'.",
  input_schema: { type: "object", properties: {} },
};

export const READ_ARCHIVE_TOOL = {
  name: "read_archive",
  description: "Look up PRIOR closed months — the store's banked history. Returns each closed month's store totals (retail units, gross, front/back, PVR, PPU, F&I PVR, new/used mix). Optionally filter to one month by name or YYYY-MM ('June', '2026-06'). Use for 'how did we do last month', month-over-month trends, or 'best month this year'. Store totals only (no per-customer detail).",
  input_schema: { type: "object", properties: { month: { type: "string", description: "Optional: a month to look up, e.g. 'June' or '2026-06'. Omit for the last several months." } } },
};

