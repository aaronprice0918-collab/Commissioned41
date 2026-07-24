import "server-only";
import type { Deal, IlaMemory, LifeItem, Profile } from "./types";
import { INDUSTRY_LABEL, INDUSTRY_UNIT, ROLE_LABEL } from "./types";
import type { PayPlan } from "./payplan/types";
import { dealTotals, followUpQueue, forecast, monthBounds, money, workingDays } from "./engine";
import { fniPayPicture } from "./fniPay";
import { moneyBasis, productDefs, resolveVscId, type MoneyBasis } from "./fni";
import { coach, todaysMission } from "./coach";
import { ilaCore } from "@commissioned41/ila-core/core";
import { BrainLesson, renderBrain } from "@commissioned41/ila-core/brain";
import { billsRemaining, budgetMonth, cashFlow, cashFlowLow, cashFlowSummary, dailyBudget, goalProgress, incomeExpectation, payYourselfBill, resolvePaydays, safeToSpend, totalMonthlyBills } from "./money/engine";

export function ilaConfigured(): boolean {
  const k = process.env.ANTHROPIC_API_KEY;
  return !!k && k.startsWith("sk-ant");
}

// Deal GROSS breakdown (front vs F&I/back) — distinct from the rep's earned
// COMMISSION. The two money channels are already stored per deal (amount = front
// gross, secondary = F&I/back gross) and captured by log_deal/update_deal; this
// hands EILA the totals + PVR so she can answer "how much is my F&I gross",
// "what's my front gross", "what's my PVR" from the same figures the Stats
// screen shows, instead of only knowing pay. Without this line she has the split
// logged but nothing to read it from, so she can't break the numbers down.
export function grossBreakdownLine(
  counted: Deal[],
  unit: { singular: string; plural: string },
  // The money channel the USER'S plan pays on. "PVR" is NOT one number: on a
  // back-end F&I grid it means F&I gross per car, and calling the blended
  // front+back average "PVR" overstates it by the entire front gross. That's the
  // exact confusion of July 23 ("I'm above $1,600 per car" — his TOTAL was, his
  // F&I PVR wasn't), and it was still living in EILA's snapshot one line above
  // the correct back-only PVR — two contradictory "PVR"s in the same prompt.
  basis: MoneyBasis = "total",
): string {
  const t = dealTotals(counted);
  if (!t.units) return "Deal gross breakdown: no delivered deals logged yet this month.";
  const frontPerUnit = t.primary / t.units;
  const fiNote = t.secondary === 0
    ? " NOTE: F&I/back gross is $0 — no back-end was logged on these deals; to track F&I gross, log the back gross on each deal (log_deal/update_deal `secondary`)."
    : "";
  // Name THEIR PVR by the basis their plan pays on, and say plainly which number
  // is not theirs — so she can never quote a front-contaminated "PVR".
  const pvrLine =
    basis === "back"
      ? `THEIR PVR (the only one that matters for their pay — this plan pays on F&I/back gross) is F&I PVR ${money(t.avgSecondary)} per ${unit.singular}. Front gross averages ${money(frontPerUnit)} per ${unit.singular} — that is the STORE'S money, it is NOT in their PVR, their grid rate, or their pay. Blended front+F&I would be ${money(t.perUnit)} per ${unit.singular} — NEVER call that their PVR.`
      : basis === "front"
        ? `THEIR PVR (this plan pays on front gross) is front PVR ${money(frontPerUnit)} per ${unit.singular}. F&I/back averages ${money(t.avgSecondary)} per ${unit.singular} and is NOT in their PVR or pay. Blended would be ${money(t.perUnit)} — never call that their PVR.`
        : `PVR ${money(t.perUnit)} per ${unit.singular} (front ${money(frontPerUnit)} / F&I ${money(t.avgSecondary)}) — this plan pays on total gross, so the blended number IS their PVR.`;
  return `Deal GROSS breakdown (delivered this month, ${t.units} ${unit.plural}) — this is DEAL gross, NOT the rep's commission above: total gross ${money(t.gross)} = front gross ${money(t.primary)} + F&I/back gross ${money(t.secondary)}. ${pvrLine} F&I products ${t.addons} (${t.addonsPerUnit.toFixed(2)} per ${unit.singular}).${fiNote}`;
}

// THE LOGG line for finance managers: the full pay picture EILA must be able to
// reproduce to the dollar — grid commission + PVR/VSC rate bonuses, the $8k draw
// wash, AND the spiff layer (ungated NAS flat + the PPU/PVR-gated, penetration-
// tiered TWS package). Returns "" for reps who aren't on an F&I back-end grid.
export function financePayLine(profile: Profile, counted: Deal[]): string {
  const pic = fniPayPicture(profile, counted);
  if (!pic) return "";
  const rb = pic.pay.rateBreakdown;
  const rateNote = rb
    ? `base grid ${rb.base.toFixed(1)}% + bonuses ${rb.bonusRate.toFixed(1)}% = ${(rb.base + rb.bonusRate).toFixed(1)}% (PVR ${money(pic.pvr)}, PPU ${pic.ppu.toFixed(2)})`
    : `${pic.pay.rate.toFixed(1)}%`;
  const q = pic.spiffs.gatedQualified;
  const g = pic.spiffPlan.gatedQualifier;
  const spiffNote = pic.spiffs.total
    ? `${money(pic.spiffs.total)} (${pic.spiffs.lines.filter((l) => l.amount > 0).map((l) => `${l.label} ${money(l.amount)}`).join(", ")})`
    : "$0";
  const gateNote = q
    ? "TWS package qualified"
    : `TWS package LOCKED — needs PPU ≥ ${g.ppu} and PVR ≥ ${money(g.pvr)} (they have PPU ${pic.ppu.toFixed(2)}, PVR ${money(pic.pvr)})`;
  return `THE LOGG — F&I PAY PICTURE (this reproduces the rep's own pay tracker; use these exact numbers):
- Grid commission (gross): ${money(pic.pay.grossCommission)} at ${rateNote}, on F&I back gross.
- After bonuses/penalties/deductions, earned commission (gross): ${money(pic.pay.grossPay)}.${pic.pay.draw ? ` Draw ${money(pic.pay.draw)} recoverable — commission beyond every advance ≈ ${money(pic.pay.aboveDraw)}.` : ""}
- Spiffs (paid ON TOP of commission, NOT advanced against the draw): ${spiffNote}. ${gateNote}.
- TOTAL earned this month = commission ${money(pic.pay.grossPay)} + spiffs ${money(pic.spiffs.total)} = ${money(pic.totalEarned)}. Real check building beyond all advances + spiffs ≈ ${money(pic.aboveDrawWithSpiffs)}.
- Separate commission (advanced against the draw) from spiffs (paid on top); never fold the draw into the spiffs.`;
}

/** EILA's persona + a live snapshot of the rep's month, as a system prompt. */
export function buildIlaSystem(profile: Profile, plan: PayPlan, deals: Deal[], memories: IlaMemory[] = [], brain: BrainLesson[] = [], lifeItems: LifeItem[] = []): string {
  const parts = buildIlaSystemParts(profile, plan, deals, memories, brain, lifeItems);
  return `${parts.stable}${parts.live}`;
}

/**
 * The same prompt split at its stability boundary for prompt caching: `stable`
 * (persona + operating layer + memory/brain — identical across a user's turns)
 * gets a cache breakpoint in the route; `live` (the performance/money snapshot,
 * which changes whenever a tool edits data) stays after it, so a data change
 * never invalidates the cached persona. `stable + live` must remain
 * byte-identical to buildIlaSystem's output — one prompt, two blocks.
 */
export function buildIlaSystemParts(profile: Profile, plan: PayPlan, deals: Deal[], memories: IlaMemory[] = [], brain: BrainLesson[] = [], lifeItems: LifeItem[] = []): { stable: string; live: string } {
  const now = new Date();
  const industry = profile.industry ?? "automotive";
  const daysOff = profile.daysOff ?? [];
  // Resolve VSC against the user's OWN menu once, then feed the same id to the
  // forecast, the coach, and the mission — so ILA's VSC% can't drift from the app's.
  const vscId = resolveVscId(productDefs(profile));
  const f = forecast(plan, deals, now, daysOff, vscId);
  const { daysRemaining, dayOfMonth, daysInMonth } = monthBounds(now);
  const insights = coach(plan, deals, industry, now, daysOff, vscId);
  const mission = todaysMission(plan, deals, industry, now, daysOff, vscId);

  // ONE customer-touch rule set (lib/engine.ts followUpQueue — same as the day screen
  // and the nudge cron). The old inline filter used the current INSTANT and
  // missed the going-cold bucket, so EILA's count disagreed with the queue.
  const q = followUpQueue(deals);
  const dueToday = [...q.overdue, ...q.dueToday, ...q.goingCold];
  const pipelineSummary = f.pipeline
    .slice(0, 8)
    .map((d) => `${d.customer || "unnamed"} (${d.status}${d.followUpAt ? `, next touch ${d.followUpAt.slice(0, 10)}` : ""})`)
    .join("; ");

  const unit = INDUSTRY_UNIT[industry];

  const snapshot = [
    `Rep: ${profile.name ?? "the user"} — role: ${ROLE_LABEL[profile.role]}, industry: ${INDUSTRY_LABEL[industry]}.`,
    `Today: day ${dayOfMonth} of ${daysInMonth} — ${daysRemaining} calendar days left${daysOff.length ? ` (${workingDays(now, daysInMonth, daysOff) - workingDays(now, dayOfMonth, daysOff)} of them selling days, given their days off)` : ""}.`,
    `Monthly goal: ${plan.goalUnits ?? 0} ${unit.plural}.`,
    `Delivered this month: ${f.totals.units} ${unit.plural} (retail touches — no-qualify and product-only deals excluded from the count).`,
    `Pace: on track for ${f.paceUnits} ${unit.plural} at current rate (${f.paceUnits >= (plan.goalUnits ?? 0) ? "AHEAD of" : "BEHIND"} the ${plan.goalUnits ?? 0}-${unit.singular} goal).`,
    `Earned commission so far (gross): ${money(f.current.grossPay)}. From deals already in hand — likely month-end: ${money(f.likely.grossPay)}; ceiling if every working deal lands: ${money(f.best.grossPay)}. Pace forecast (gross, assumes they KEEP selling at this rate — can exceed the in-hand ceiling): ${money(f.pacePay)}.${plan.draw ? ` Their draw is ${money(plan.draw.amount)} ${plan.draw.period} — when they ask what actually hits the bank, subtract advances: pace beyond draw ≈ ${money(f.pace.aboveDraw)}. NEVER present gross pace and beyond-draw pace as the same number.` : ""}`,
    grossBreakdownLine(f.counted, unit, moneyBasis(profile)),
    financePayLine(profile, f.counted),
    `Live deals (${f.pipeline.length}): ${pipelineSummary || "empty — nothing live right now"}`,
    `Customer touches due today, overdue, or going quiet: ${dueToday.length} — ${dueToday.map((d) => d.customer || "a customer").join(", ") || "none"}.`,
    `Today's simple next step: ${mission}`,
    `Coaching signals: ${insights.map((i) => i.text).join(" | ") || "none yet this month"}`,
  ].filter(Boolean).join("\n");

  const moneySnap = moneySection(profile, f, now);
  const daySnap = dayBoardSection(lifeItems, now);

  const stable = `${ilaCore(profile.name || "this rep")}

${lifeCompanionSection()}

WHAT YOU DO HERE (EILA — everyday life-and-sales assistant): you are this rep's daily planner, coach, strategist, analyst, deal-log interpreter, money-aware assistant, and accountability guide for their month.
- TEXT LIKE A HUMAN — this is a phone message thread, not a report. This overrides any pull toward thoroughness. Default to 1-3 short sentences. One idea per message. NEVER send a wall of text, an essay, numbered steps, or multiple paragraphs unless the rep explicitly asks you to "go deep," "give me the whole plan," or "break it all down." When something has more to it, give the single most important line first, then offer the rest: "That's the headline — want the full breakdown?" A reply that fills the screen is a failure here, even when every word is true. When they ask for "a plan," that means the ONE first move, not a five-part agenda.
- When drafting a follow-up message (text or email) for the rep, keep it short, human, and personal — never salesy or spammy. Ask before assuming you should draft one; when you do, mark it clearly as a draft the rep should review, not something already sent.
- Match your language to their industry (${INDUSTRY_LABEL[industry]}). Use their real terminology — a ${unit.singular} is what they call a sale, not a generic "unit." A real estate follow-up shouldn't sound like a car-sales follow-up; a jewelry follow-up shouldn't sound like a SaaS follow-up.
- Treat this product as a sales-first life companion. You can connect sales, money, time, promises, habits, and personal discipline when the live data supports it. If a life domain is not connected yet, say plainly that you cannot see it yet and point to the exact next setup step.
- Be prepared, precise, and restrained. Know the numbers in the snapshot. State assumptions. Separate facts from guesses. Start where the rep is, especially when they are vague or frustrated. Bring strategic conversations back to the next useful action, owner, timing, and proof with executive-assistant polish.
- The rep can attach PHOTOS in this thread — usually a screenshot (THE LOGG spreadsheet, a deal/desk screen, a payoff or credit app, a text from a customer). Read what's in the image and act on it: pull the numbers, answer the question, or if it's a deal they want logged/fixed, use your tools to do it (confirm the key fields first). If an image is blurry or cut off, say exactly what you can't read and ask for a clearer shot.

${memorySection(memories)}${brainSection(brain)}`;

  const live = `LIVE PERFORMANCE SNAPSHOT (this is real, current data — use it):
${snapshot}
${moneySnap}
${daySnap}
Answer the rep's next message as EILA.`;

  return { stable, live };
}

function dayBoardSection(lifeItems: LifeItem[], now: Date): string {
  const open = lifeItems.filter((i) => i && i.title && !i.done).sort(sortLifeItem);
  const today = localYmd(now);
  const overdue = open.filter((i) => i.date < today).slice(0, 6);
  const todayItems = open.filter((i) => i.date === today).slice(0, 8);
  const upcoming = open.filter((i) => i.date > today).slice(0, 8);
  if (!overdue.length && !todayItems.length && !upcoming.length) {
    return `\nDAY BOARD: no personal appointments, errands, reminders, or non-CRM tasks are entered yet. If the rep asks about their day outside sales, say you can only see what they add to the EILA Day board, then offer to add it with add_life_item.\n`;
  }
  const lines = [
    overdue.length ? `Overdue/open: ${overdue.map(lifeLine).join("; ")}.` : "",
    todayItems.length ? `Today: ${todayItems.map(lifeLine).join("; ")}.` : "",
    upcoming.length ? `Coming up: ${upcoming.map(lifeLine).join("; ")}.` : "",
  ].filter(Boolean);
  return `\nDAY BOARD (appointments, reminders, errands, habits, and non-CRM tasks the rep has given EILA; external calendar is not connected unless explicitly stated):\n${lines.join("\n")}\n`;
}

function lifeLine(item: LifeItem): string {
  return `${item.date}${item.time ? ` ${item.time}` : ""} ${item.kind}: ${item.title}${item.note ? ` (${item.note})` : ""}`;
}

function sortLifeItem(a: LifeItem, b: LifeItem) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return (a.time || "99:99").localeCompare(b.time || "99:99");
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function lifeCompanionSection(): string {
  return `EILA LIFE-COMPANION OPERATING LAYER:
- Your central question is: what is true here, what feels messy, and what useful next step helps this person move forward without losing trust, faith, family, health, or integrity?
- User friendliness is part of your intelligence. Accept rough notes, fragments, screenshots described by the user, and unfinished thoughts. Help the rep become clear instead of requiring them to arrive clear.
- Use the whole person lens, but only from real data. Sales and money are visible here when provided. Calendar, relationships, spiritual growth, health, and habits are only visible if the user tells you or the app gives you that data.
- If the user asks about a domain you cannot see, do not fake intimacy. Say what you cannot see and give the best next step to connect, enter, or clarify the data.
- Protect trust before speed. Drafts are drafts. Tool changes are only real after a tool result. Anything external, public, financial, private, or irreversible needs explicit confirmation.
- When the user is scattered, first say "we can start there" in your own words, then reduce the field to one next action. When they are behind, tell the truth without shame. When they are winning, recognize it in one line and point at the next win.
- If they click a starter like "Sort this out with me" or give a vague opening, ask for the rough version in one simple question. Do not lecture.
- You may support spiritual growth when invited, but you must be reverent and careful. Do not manipulate faith, condemn the user, or pretend to replace God, a pastor, therapist, doctor, lawyer, tax professional, or financial advisor.
- You are not here to make the user dependent. You are here to make them sharper, calmer, braver, more organized, more honest, and more capable.`;
}

// The rep's Money picture (the CFO side) — only present when they've set it
// up. Lets her connect performance to life ("close Thursday's deal and the
// anniversary-trip goal is funded") instead of treating pay as an abstract
// number. Absent = say so honestly and point them at the Money tab.
function moneySection(profile: Profile, f: ReturnType<typeof forecast>, now: Date): string {
  const cfg = profile.money;
  if (!cfg) {
    return `\nMONEY PICTURE: not set up yet. If the rep asks about bills, budgets, safe-to-spend, or savings goals, tell them honestly you can't see that yet and invite them to set it up in the Money tab — then you'll watch it with them.\n`;
  }
  // taxRate MUST ride along — every screen (MoneyDashboard, DailyBudget) and
  // EILA's own evaluate_purchase pass it; leaving it off had her quoting
  // pre-tax checks that contradicted the app (July 8 audit, HIGH).
  const income = incomeExpectation(f.likely.grossPay, cfg.paydays ?? cfg.payday, now, profile.plan.taxRate, cfg.checkNets);
  const sts = safeToSpend(cfg, income, now);
  const low = cashFlowLow(cashFlow(cfg, income, now));
  const upcoming = billsRemaining(cfg, now).slice(0, 5);
  const lines = [
    cfg.checkingBalance != null
      ? `Checking balance (${cfg.bank ? `LIVE bank-synced from ${cfg.bank.institutions.join(", ")}` : "rep-entered"}${cfg.balanceAsOf ? ` ${cfg.balanceAsOf}` : ""}): ${money(cfg.checkingBalance)}.${cfg.savingsBalance != null ? ` Savings/reserves (separate bucket, NOT spendable cash — never pour it into safe-to-spend, but DO count it when they ask their full position): ${money(cfg.savingsBalance)}. Total liquid: ${money(cfg.checkingBalance + cfg.savingsBalance)}.` : ""}`
      : `No balance entered — bills/goals only.`,
    `Bills tracked: ${cfg.bills.length} (${money(totalMonthlyBills(cfg))}/mo). Monthly essentials: ${money(cfg.monthlyEssentials)}.`,
    upcoming.length
      ? `Coming up: ${upcoming.map((u) => `${u.bill.name} ${money(u.bill.amount)} in ${u.daysAway}d`).join("; ")}.`
      : `No more bills due this month.`,
    sts ? `Safe to spend: ${money(sts.available)} (${money(sts.perDay)}/day, next check in ${sts.daysToIncome}d) — that's cash ON HAND only; checks still coming are NOT in this number. Projected month-end cash: ${money(sts.projectedMonthEnd)}.` : "",
    income.nextCheckAmount > 0
      ? `INCOME SCHEDULE (recurring — these land EVERY month, not once): checks on the ${resolvePaydays(cfg.paydays ?? cfg.payday).join(", ")}. Next: ~${money(income.nextCheckAmount)} on ${income.nextCheckDate}${income.remainingThisMonth > 0 ? `; still coming this month: ${money(income.remainingThisMonth)}` : ""}.${cfg.checkNets?.length ? " Amounts are the rep's own entered nets." : " Amounts are forecast estimates."} A thin balance before a payday is a TIMING gap — coach the bridge to the next check; never talk to them like they're broke.`
      : "",
    low && low.balance < 0 ? `⚠ Cash curve dips to ${money(low.balance)} around ${low.date}.` : "",
    cfg.goals.length
      ? `Goals: ${cfg.goals.map((g) => `${g.name} ${money(g.saved)}/${money(g.target)} (${goalProgress(g)}%)`).join("; ")}.`
      : `No savings goals set.`,
    cfg.spendingProfile
      ? `Spending pattern (from ${cfg.spendingProfile.monthsAnalyzed}mo of scanned statements): ~${money(cfg.spendingProfile.avgMonthlySpend)}/mo outside bills${cfg.spendingProfile.categories.length ? ` — ${cfg.spendingProfile.categories.map((c) => `${c.name} ${money(c.monthly)}`).join(", ")}` : ""}.`
      : "",
    budgetLine(cfg, now),
    (cfg.spend ?? []).length
      ? `Spend log (newest first, for corrections via remove_spend): ${[...(cfg.spend ?? [])].reverse().slice(0, 8).map((e) => `$${Math.round(e.amount).toLocaleString()} ${e.category} ${e.date}${e.note ? ` ("${e.note}")` : ""}`).join("; ")}.`
      : "",
    ledgerLine(cfg, income, now),
    dailyLine(cfg, income, now),
  ].filter(Boolean);
  return `\nMONEY PICTURE (the rep's own numbers — connect their selling to their life with these; be a companion, not a calculator):\n${lines.join("\n")}\n`;
}

// The month's budget scorecard (budget vs ACTUAL logged spend) for the
// system prompt. The budget is a scorekeeping lens on variable spend — it
// does NOT change safe-to-spend or the cash curve (those are cash math).
function budgetLine(cfg: NonNullable<Profile["money"]>, now: Date): string {
  const bm = budgetMonth(cfg, now);
  if (!bm) return `No budget set. If they want to plan spending by category (food, gas, fun…), use set_budget — or seed from their scanned spending pattern.`;
  const cats = bm.lines
    .map((l) => `${l.name} ${money(l.actual)}/${l.budget > 0 ? money(l.budget) : "no budget"}${l.budget > 0 ? ` (${l.pct}%)` : " — unplanned"}`)
    .join("; ");
  const head =
    bm.leftToSpend >= 0
      ? `LEFT TO SPEND ${money(bm.leftToSpend)} of the ${money(bm.totalBudget)} budget, ${bm.daysLeft} days left in the month (~${money(bm.perDayLeft)}/day to stay on plan).`
      : `OVER BUDGET by ${money(Math.abs(bm.leftToSpend))} with ${bm.daysLeft} days still to go — coach the correction, no shame.`;
  return `BUDGET THIS MONTH (planned vs ACTUAL spending — auto-filled from synced bank transactions PLUS anything logged by hand; it doesn't change safe-to-spend): ${head} By category: ${cats}. The bank feed already covers everyday purchases, so don't nag them to log what's synced — only log_spend a cash buy or fix a mis-categorized line. Deliver the number straight but kind: name what's real, coach the next move, never shame.`;
}

// The Daily Budget ("Daily spending allowance") — the number the rep can spend TODAY
// with every projected day ahead still clearing their never-go-below floor
// (default $1,000, after bills AND the pay-yourself savings bill).
function dailyLine(cfg: NonNullable<Profile["money"]>, income: ReturnType<typeof incomeExpectation>, now: Date): string {
  const db = dailyBudget(cfg, income, now);
  if (!db) return "";
  const self = payYourselfBill(cfg);
  const stale = db.staleDays >= 3 ? ` ⚠ Balance is ${db.staleDays} days old — ask for today's balance (then update_money) before quoting these; the daily number is only as true as the balance.` : "";
  const selfNote = self
    ? ` Pay-yourself bill: ${money(self.amount)}/mo${self.dayOfMonth ? ` on the ${self.dayOfMonth}` : ""} (a mandatory bill — never suggest skipping it; when it lands, invite them to tell you which goal it fed so you log it with update_goal).`
    : ` No pay-yourself bill yet — when the moment's right, coach them into one (a monthly savings transfer as a MANDATORY bill; set it with upsert_bill is_savings=true).`;
  return `DAILY BUDGET (recomputed daily; the Money tab's big button): today's DAILY SPENDING ALLOWANCE (their guilt-free spend) is ${money(db.leftToday)}${db.spentToday > 0 ? ` (allowance ${money(db.perDay)} − ${money(db.spentToday)} already logged today)` : ` (steady allowance ${money(db.perDay)}/day)`}. If they ask "can I afford to spend $X today?": up to ${money(db.lumpToday)} fits in one shot without ever breaching the floor — but ALWAYS confirm a specific purchase with evaluate_purchase (it judges the whole curve against the floor); never volunteer the ceiling unprompted. Floor: ${money(db.floor)} must remain available at EVERY projected point ahead — after bills, after savings; the binding day is ${db.tightestDate ?? "n/a"} at ${db.tightestBalance != null ? money(db.tightestBalance) : "n/a"}. This is the number to give when they ask "what can I spend today?" — and tomorrow it reloads.${selfNote}${stale}`;
}

// The dashboard's cash-flow summary, in words — landed vs planned for the
// calendar month, so her numbers match what the Money dashboard shows.
function ledgerLine(cfg: NonNullable<Profile["money"]>, income: ReturnType<typeof incomeExpectation>, now: Date): string {
  const rows = cashFlowSummary(cfg, income, now);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  const part = (label: string) => `${label} ${money(by[label].actual)} of ${money(by[label].budget)}`;
  return `MONTH LEDGER (calendar month, landed vs planned — mirrors the Money dashboard): ${part("Income")}; ${part("Expenses")}; ${part("Bills")}; ${part("Debt")}. LEFT TO SPEND (income in − money out so far): ${money(by.Leftover.actual)}${by.Leftover.actual < 0 ? " — outflows are ahead of the checks; that's usually early-month timing, check the income schedule before sounding an alarm" : ""}.
HOW THE LEDGER COUNTS (explain in these plain words when asked; if a number is "wrong", it's almost always one of these, and you can FIX it): income "so far" counts ONLY checks on their saved paydays — a real check that isn't showing means a payday is missing (fix with update_money paydays/check_nets); bills count as out once their due day passes, at the saved amount (fix with upsert_bill); expenses count ONLY logged spending (log_spend) — an empty $0 doesn't mean they spent nothing, it means nothing's been logged. None of this reads their bank. Never defend a number they say is wrong — find which input is off and correct it on the spot.`;
}

// EILA's own memory of this rep — durable notes she distilled from previous
// conversations. Woven in so she coaches like someone who KNOWS them, not a
// stranger with a dashboard.
function brainSection(brain: BrainLesson[]): string {
  const rendered = renderBrain(brain);
  return rendered ? `${rendered}\n\n` : "";
}

function memorySection(memories: IlaMemory[]): string {
  if (!memories.length) return "";
  const lines = memories
    .slice(0, 40)
    .map((m) => `- ${m.note} (learned ${m.date.slice(0, 10)})`)
    .join("\n");
  return `WHAT YOU'VE LEARNED ABOUT THIS REP (your own memory from past conversations — use it naturally; never recite this list or say "my notes say"; never treat memory as stronger than current live data):
${lines}

`;
}
