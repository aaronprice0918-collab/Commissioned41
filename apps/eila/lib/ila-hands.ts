"use client";

// Client-side execution of EILA's tool calls — the data lives on the device,
// so her hands work here, through the same store the user's own taps use.

import type { Deal, IlaMemory, LifeItemKind, ProductDef, Profile } from "./types";
import type { PayPlan } from "./payplan/types";
import { classifyPlan } from "./payplan/calc";
import { dealUnits, productDefs } from "./fni";
import type { IlaToolCall } from "./ila-tools";
import type { Bill, MoneyConfig, MoneyGoal } from "./money/types";
import { defaultMoneyConfig } from "./money/types";
import { addSpend, applyBankSync, budgetMonth, evaluatePurchase, incomeExpectation, removeSpend, resolvePaydays, setMerchantRule, merchantKeyFor, setSpendAccount, accountLabelFor, upsertBudget, type BankSyncPayload } from "./money/engine";
import { forecast, localDayKey } from "./engine";
import { parseLoggCsv } from "./loggImport";

export interface HandsCtx {
  profile: Profile;
  deals: Deal[];
  memories: IlaMemory[];
  updateDaysOff: (days: number[]) => void;
  updateProducts: (products: ProductDef[]) => void;
  updateDeal: (id: string, patch: Partial<Deal>) => void;
  updateMoney: (money: MoneyConfig) => void;
  updatePlan: (plan: PayPlan) => void;
  addDeal: (deal: Omit<Deal, "id">) => void;
  addDeals: (deals: Omit<Deal, "id">[]) => void;
  importDeals: (deals: Omit<Deal, "id">[]) => { added: number; updated: number };
  removeDeal: (id: string) => void;
  addLifeItem: (item: { title: string; kind: LifeItemKind; date: string; time?: string; note?: string }) => void;
  clearSampleData: () => void;
  forgetIlaMemory: (id: string) => void;
  authToken?: string;
}

export interface HandsResult {
  content: string; // tool_result content for EILA
  isError?: boolean;
  friendly?: string; // short chip shown in the chat UI ("✓ Days off updated")
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEAL_STATUSES: Deal["status"][] = ["prospect", "appointment", "working", "pending", "finance", "delivered", "dead"];
const LIFE_KINDS: LifeItemKind[] = ["appointment", "task", "personal"];

export async function executeIlaTool(call: IlaToolCall, ctx: HandsCtx): Promise<HandsResult> {
  try {
    switch (call.name) {
      case "set_days_off": {
        const days = [...new Set((call.input.days as number[]) ?? [])]
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          .sort();
        if (days.length >= 7) return { content: "Rejected: can't mark every day off.", isError: true };
        ctx.updateDaysOff(days);
        const names = days.map((d) => DAY_NAMES[d]).join(" + ") || "none";
        return { content: `Done. Days off are now: ${names}. Pace and projections recalculated over working days.`, friendly: `✓ Days off: ${names}` };
      }

      case "update_products": {
        const raw = (call.input.products as Partial<ProductDef>[]) ?? [];
        const clean: ProductDef[] = raw
          .filter((p) => p && typeof p.label === "string" && p.label.trim())
          .slice(0, 20)
          .map((p, i) => ({
            id: typeof p.id === "string" && p.id ? p.id : `p${Date.now().toString(36)}${i}`,
            label: String(p.label).trim().slice(0, 40),
            units: Math.max(0, Number(p.units) || 0),
            spiff: Math.max(0, Number(p.spiff) || 0),
          }));
        if (!clean.length) return { content: "Rejected: empty product menu.", isError: true };
        ctx.updateProducts(clean);
        return {
          content: `Done. Product menu is now: ${clean.map((p) => `${p.label} (${p.units}u, $${p.spiff} spiff)`).join(", ")}.`,
          friendly: "✓ Product menu updated",
        };
      }

      case "update_deal": {
        const ref = String(call.input.deal ?? "").trim().toLowerCase();
        if (!ref) return { content: "No deal reference given.", isError: true };
        // Dead deals ARE matchable — that's how one gets revived or corrected.
        // (Filtering them out made EILA say "no deal found" for a deal the user
        // could see — July 8 audit.)
        const matches = ctx.deals.filter(
          (d) => d.dealNumber?.toLowerCase() === ref || (d.customer && d.customer.toLowerCase().includes(ref)),
        );
        if (matches.length === 0) {
          return { content: `No deal found matching "${call.input.deal}". Ask the user which customer or deal number they mean.`, isError: true };
        }
        if (matches.length > 1) {
          const list = matches.slice(0, 5).map((d) => `${d.customer} (#${d.dealNumber || "no #"}, ${d.date.slice(0, 10)}, ${d.status})`).join("; ");
          return { content: `Multiple deals match: ${list}. Ask the user which one.`, isError: true };
        }
        const deal = matches[0];
        const ch = (call.input.changes ?? {}) as Record<string, unknown>;
        const patch: Partial<Deal> = {};
        const applied: string[] = [];

        if (typeof ch.status === "string") {
          // Validate the enum — a bare cast let any string reach the store,
          // and STATUS_WEIGHT[bad] = undefined poisons the likely-forecast math.
          if (!DEAL_STATUSES.includes(ch.status as Deal["status"])) {
            return { content: `Invalid status "${ch.status}". Valid: ${DEAL_STATUSES.join(", ")}.`, isError: true };
          }
          patch.status = ch.status as Deal["status"]; applied.push(`status → ${ch.status}`);
        }
        for (const k of ["amount", "secondary", "reserve"] as const) {
          if (typeof ch[k] === "number" && isFinite(ch[k] as number)) { patch[k] = ch[k] as number; applied.push(`${k} → $${ch[k]}`); }
        }
        if (typeof ch.customer === "string" && (ch.customer as string).trim()) { patch.customer = (ch.customer as string).trim(); applied.push("customer name"); }
        if (typeof ch.salesperson === "string") { patch.salesperson = (ch.salesperson as string).trim() || undefined; applied.push("salesperson"); }
        if (typeof ch.salesperson2 === "string") { patch.salesperson2 = (ch.salesperson2 as string).trim() || undefined; applied.push("split partner"); }
        if (typeof ch.bank === "string") { patch.bank = (ch.bank as string).trim() || undefined; applied.push("bank"); }
        if (typeof ch.funded === "boolean") { patch.funded = ch.funded; applied.push(ch.funded ? "funded" : "waiting on funding"); }
        if (typeof ch.no_qualify === "boolean") { patch.noQualify = ch.no_qualify || undefined; applied.push(`no-qualify ${ch.no_qualify ? "on" : "off"}`); }
        if (typeof ch.product_only === "boolean") { patch.productOnly = ch.product_only || undefined; applied.push(`product-only ${ch.product_only ? "on" : "off"}`); }
        if (typeof ch.deal_number === "string") { patch.dealNumber = (ch.deal_number as string).trim() || undefined; applied.push("deal #"); }
        if (typeof ch.phone === "string") { patch.phone = (ch.phone as string).trim() || undefined; applied.push("phone"); }
        if (typeof ch.note === "string") { patch.note = (ch.note as string).trim() || undefined; applied.push("note"); }
        if (typeof ch.follow_up_date === "string") {
          const v = (ch.follow_up_date as string).trim();
          // Validate the date like log_deal / add_life_item do. An unparseable
          // value (e.g. "next friday") makes new Date(...).toISOString() throw,
          // which the outer catch turns into a whole-update failure — silently
          // dropping the status/amount/etc. changes in the SAME call. Skip just
          // the reminder instead so the rest of the update still lands.
          if (!v) {
            patch.followUpAt = undefined; applied.push("reminder cleared");
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            patch.followUpAt = new Date(`${v}T09:00:00`).toISOString(); applied.push(`reminder → ${v}`);
          } else {
            applied.push(`(skipped reminder — need a YYYY-MM-DD date, got "${v}")`);
          }
        }

        // products: resolve names/ids against the user's own menu
        const defs = productDefs(ctx.profile);
        const resolve = (s: string) =>
          defs.find((p) => p.id === s || p.label.toLowerCase() === s.toLowerCase() || p.label.toLowerCase().includes(s.toLowerCase()))?.id;
        const adds = ((ch.products_add as string[]) ?? []).map(String);
        const removes = ((ch.products_remove as string[]) ?? []).map(String);
        if (adds.length || removes.length) {
          let list = [...(deal.products ?? [])];
          const unknown: string[] = [];
          for (const a of adds) {
            const id = resolve(a);
            if (!id) unknown.push(a);
            else if (!list.includes(id)) list.push(id);
          }
          for (const r of removes) {
            const id = resolve(r);
            if (!id) unknown.push(r);
            else list = list.filter((x) => x !== id);
          }
          if (unknown.length) {
            return { content: `Unknown product(s): ${unknown.join(", ")}. The menu is: ${defs.map((p) => p.label).join(", ")}. Ask the user, or update the menu first.`, isError: true };
          }
          patch.products = list;
          patch.addons = dealUnits({ ...deal, products: list }, defs);
          applied.push(`products → ${list.map((id) => defs.find((p) => p.id === id)?.label).join(", ") || "none"}`);
        }

        if (!applied.length) return { content: "No valid changes given.", isError: true };
        ctx.updateDeal(deal.id, patch);
        return {
          content: `Done — ${deal.customer} (#${deal.dealNumber || "no #"}): ${applied.join(", ")}. All numbers recalculated.`,
          friendly: `✓ ${deal.customer}: ${applied.join(", ")}`,
        };
      }

      case "log_deal": {
        const customer = String(call.input.customer ?? "").trim();
        if (!customer) return { content: "A customer name is needed to log a deal.", isError: true };
        const statusIn = String(call.input.status ?? "delivered");
        if (!DEAL_STATUSES.includes(statusIn as Deal["status"]) || statusIn === "dead") {
          return { content: `Invalid status "${statusIn}". Valid: ${DEAL_STATUSES.filter((s) => s !== "dead").join(", ")}.`, isError: true };
        }
        const n = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : 0);
        // products resolve against the user's OWN menu, same as update_deal
        const defs = productDefs(ctx.profile);
        const resolve = (s: string) =>
          defs.find((p) => p.id === s || p.label.toLowerCase() === s.toLowerCase() || p.label.toLowerCase().includes(s.toLowerCase()))?.id;
        const wanted = ((call.input.products as string[]) ?? []).map(String);
        const products: string[] = [];
        const unknown: string[] = [];
        for (const w of wanted) {
          const id = resolve(w);
          if (!id) unknown.push(w);
          else if (!products.includes(id)) products.push(id);
        }
        if (unknown.length) {
          return { content: `Unknown product(s): ${unknown.join(", ")}. The menu is: ${defs.map((p) => p.label).join(", ")}. Ask the user, or update the menu first.`, isError: true };
        }
        const str = (k: string) => (typeof call.input[k] === "string" && (call.input[k] as string).trim() ? (call.input[k] as string).trim() : undefined);
        const dateIn = typeof call.input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(call.input.date as string) ? (call.input.date as string) : undefined;
        const followIn = typeof call.input.follow_up_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(call.input.follow_up_date as string) ? (call.input.follow_up_date as string) : undefined;
        const deal: Omit<Deal, "id"> = {
          // noon-local for a given day, so the deal can't drift across a month
          // boundary in either UTC or local bucketing
          date: dateIn ? new Date(`${dateIn}T12:00:00`).toISOString() : new Date().toISOString(),
          customer,
          item: str("item") ?? "",
          category: undefined,
          amount: n(call.input.amount),
          secondary: n(call.input.secondary),
          reserve: n(call.input.reserve),
          addons: 0,
          status: statusIn as Deal["status"],
          ...(call.input.product_only === true ? { productOnly: true } : {}),
          ...(products.length ? { products } : {}),
          ...(str("salesperson") ? { salesperson: str("salesperson") } : {}),
          ...(str("salesperson2") ? { salesperson2: str("salesperson2") } : {}),
          ...(str("bank") ? { bank: str("bank") } : {}),
          ...(str("deal_number") ? { dealNumber: str("deal_number") } : {}),
          ...(str("phone") ? { phone: str("phone") } : {}),
          ...(str("note") ? { note: str("note") } : {}),
          ...(followIn ? { followUpAt: new Date(`${followIn}T09:00:00`).toISOString() } : {}),
        };
        deal.addons = products.length ? dealUnits(deal as Deal, defs) : 0;
        const hadDemo = ctx.deals.some((d) => d.demo);
        ctx.addDeal(deal);
        const money$ = (v: number) => `$${Math.round(v).toLocaleString()}`;
        const parts = [
          `${customer} logged as ${statusIn}`,
          deal.amount ? `front ${money$(deal.amount)}` : "",
          deal.secondary ? `back ${money$(deal.secondary)}` : "",
          products.length ? `products: ${products.map((id) => defs.find((p) => p.id === id)?.label).join(", ")}` : "",
        ].filter(Boolean);
        return {
          content: `Done — ${parts.join(" · ")}.${hadDemo ? " Sample data auto-cleared — the board is their real numbers now." : ""} All month numbers recalculated; quote the updated ones.`,
          friendly: `✓ Logged: ${customer} (${statusIn})`,
        };
      }

      case "import_deals": {
        // THE LOGG in one shot — the user pastes their spreadsheet (CSV/TSV with
        // a header row) and EILA lands every deal, mapping columns to fields and
        // products through the SAME parser the Import screen uses. One brain.
        const csv = String(call.input.csv ?? "").trim();
        if (!csv) return { content: "No spreadsheet text given. Ask the user to paste their LOGG rows (with the header row).", isError: true };
        const defs = productDefs(ctx.profile);
        if (!defs.length) return { content: "This rep's industry has no product menu, so a LOGG import wouldn't have products to map. Log deals individually instead.", isError: true };
        const res = parseLoggCsv(csv, defs, { refYear: new Date().getFullYear() });
        if (!res.deals.length) {
          return { content: `No deals parsed. ${res.warnings.join(" ") || "Make sure the paste includes the header row and at least one deal row."}`, isError: true };
        }
        const money$ = (v: number) => `$${Math.round(v).toLocaleString()}`;
        const totalBack = res.deals.reduce((s, d) => s + d.secondary, 0);
        const hadDemo = ctx.deals.some((d) => d.demo);
        // Re-sync: existing deals are matched by Deal # and CORRECTED in place;
        // only genuinely new rows are added. So a re-import fixes adjusted numbers
        // instead of duplicating the month.
        const { added, updated } = ctx.importDeals(res.deals);
        const mappedProducts = res.columns.filter((c) => c.productId).map((c) => defs.find((d) => d.id === c.productId)?.label ?? c.productId);
        const warn = res.warnings.length ? ` Heads up: ${res.warnings.join(" ")}` : "";
        const outcome = [added ? `${added} added` : "", updated ? `${updated} updated (re-synced by Deal #)` : ""].filter(Boolean).join(", ") || "no changes";
        return {
          content: `Import done — ${outcome}${res.skipped ? ` (skipped ${res.skipped} blank/total rows)` : ""}. Total F&I back gross ${money$(totalBack)}, PVR ${money$(res.deals.length ? totalBack / res.deals.length : 0)}. Product columns mapped: ${mappedProducts.join(", ") || "none"}.${hadDemo ? " Sample data auto-cleared." : ""}${warn} All month numbers + the pay picture recalculated — quote the updated ones.`,
          friendly: `✓ THE LOGG re-synced — ${outcome}`,
        };
      }

      case "delete_deal": {
        const ref = String(call.input.deal ?? "").trim().toLowerCase();
        if (!ref) return { content: "No deal reference given.", isError: true };
        const matches = ctx.deals.filter(
          (d) => d.dealNumber?.toLowerCase() === ref || (d.customer && d.customer.toLowerCase().includes(ref)),
        );
        if (matches.length === 0) return { content: `No deal found matching "${call.input.deal}".`, isError: true };
        if (matches.length > 1) {
          const list = matches.slice(0, 5).map((d) => `${d.customer} (#${d.dealNumber || "no #"}, ${d.date.slice(0, 10)}, ${d.status})`).join("; ");
          return { content: `Multiple deals match: ${list}. Ask the user which one.`, isError: true };
        }
        const gone = matches[0];
        // Two-step confirm at the CODE layer, not just the prompt: an
        // irreversible delete only fires on an explicit confirm=true. The first
        // call returns a preview so EILA reads the exact deal back to the user
        // before anything is erased (mirrors the dealer route's confirm pattern).
        if (call.input.confirm !== true) {
          return {
            content: `About to permanently delete: ${gone.customer} (#${gone.dealNumber || "no #"}, ${gone.date.slice(0, 10)}, was ${gone.status}). This can't be undone. Confirm this is the right deal with the user, then call delete_deal again with confirm=true. (If the deal just fell through, use update_deal status "dead" instead — that keeps the history.)`,
            friendly: `Confirm delete: ${gone.customer}?`,
          };
        }
        ctx.removeDeal(gone.id);
        return {
          content: `Deleted for good — ${gone.customer} (#${gone.dealNumber || "no #"}, was ${gone.status}). The month's numbers recalculated.`,
          friendly: `✓ Deleted ${gone.customer}`,
        };
      }

      case "add_life_item": {
        const title = String(call.input.title ?? "").trim().slice(0, 90);
        if (!title) return { content: "A title is needed to add something to the Day board.", isError: true };
        const kindIn = String(call.input.kind ?? "task");
        const kind: LifeItemKind = LIFE_KINDS.includes(kindIn as LifeItemKind) ? (kindIn as LifeItemKind) : "task";
        const dateIn = typeof call.input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(call.input.date as string) ? (call.input.date as string) : localDayKey();
        const time = cleanTime(call.input.time);
        const note = typeof call.input.note === "string" && (call.input.note as string).trim() ? (call.input.note as string).trim().slice(0, 160) : undefined;
        ctx.addLifeItem({ title, kind, date: dateIn, ...(time ? { time } : {}), ...(note ? { note } : {}) });
        const when = dateIn === localDayKey() ? "today" : dateIn;
        return {
          content: `Done — "${title}" is on the EILA Day board for ${when}${time ? ` at ${displayTime(time)}` : ""}. It will now show up in the day plan.`,
          friendly: `✓ Added to day: ${title}`,
        };
      }

      case "sync_bank": {
        // Platinum VIP: pull live balances + 30 days of activity from their
        // linked bank and fold it into the money picture — same applyBankSync
        // the Money tab uses (one brain).
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const res = await fetch("/api/bank", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(ctx.authToken ? { Authorization: `Bearer ${ctx.authToken}` } : {}) },
          body: JSON.stringify({ action: "sync" }),
        });
        if (res.status === 402) {
          return {
            content:
              "They are not a Platinum VIP member. Bank sync is the VIP feature ($9.99/mo extra). Warmly point them to the upgrade card on the Money tab — never pushy.",
            friendly: "VIP feature",
          };
        }
        const j = (await res.json().catch(() => ({}))) as { sync?: BankSyncPayload | null };
        if (!j.sync) {
          return {
            content: "No bank is connected yet. They can connect one from the Money tab (Connect bank card).",
            friendly: "No bank linked",
          };
        }
        ctx.updateMoney(applyBankSync(cfg, j.sync, new Date().toISOString(), ctx.profile?.name));
        const chk = j.sync.checking != null ? `checking $${Math.round(j.sync.checking).toLocaleString()}` : "checking unchanged";
        const sav = j.sync.savings != null ? `, savings $${Math.round(j.sync.savings).toLocaleString()}` : "";
        return {
          content: `Bank synced from ${j.sync.institutions.join(", ")}: ${chk}${sav}; ${j.sync.transactions.length} settled transactions in the last 30 days now in bankTransactions. Balance is as of today — answer from these fresh numbers.`,
          friendly: "✓ Bank synced",
        };
      }
      case "update_money": {
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const next = { ...cfg };
        const applied: string[] = [];
        const bal = call.input.checking_balance;
        if (typeof bal === "number" && isFinite(bal) && bal >= 0) {
          next.checkingBalance = Math.round(bal);
          next.balanceAsOf = localDayKey(); // LOCAL day, per money/engine's own rule — UTC dated evening updates tomorrow
          applied.push(`balance → $${next.checkingBalance.toLocaleString()}`);
        }
        const pd = call.input.paydays ?? call.input.payday;
        const cnRaw = call.input.check_nets ?? call.input.check_net;
        const nets = (Array.isArray(cnRaw) ? cnRaw : typeof cnRaw === "number" ? [cnRaw] : [])
          .map((n: unknown) => Math.round(Number(n)))
          .filter((n: number) => isFinite(n) && n > 0)
          .slice(0, 4);
        if (pd != null) {
          const given = (Array.isArray(pd) ? pd : [pd])
            .map((d: unknown) => Math.round(Number(d)))
            .filter((d: number) => d >= 1 && d <= 31)
            .slice(0, 4);
          if (given.length && nets.length === given.length) {
            // Days + amounts given together: keep each check's amount glued to
            // ITS day (the wash check on the 10th isn't the 15th's check).
            const pairs = given.map((day: number, i: number) => ({ day, net: nets[i] })).sort((a, b) => a.day - b.day);
            next.paydays = pairs.map((p) => p.day);
            next.checkNets = pairs.map((p) => p.net);
            next.payday = next.paydays[0]; // keep legacy field coherent
            applied.push(`checks → ${pairs.map((p) => `$${p.net.toLocaleString()} on the ${p.day}`).join(", ")} (every month)`);
          } else if (given.length) {
            const days = resolvePaydays(given);
            next.paydays = days;
            next.payday = days[0];
            applied.push(`payday${days.length > 1 ? "s" : ""} → the ${days.join(", ")}`);
            if (nets.length) { next.checkNets = nets; applied.push(`check net${nets.length > 1 ? "s" : ""} → ${nets.map((n) => `$${n.toLocaleString()}`).join(", ")}`); }
          }
        } else if (nets.length) {
          next.checkNets = nets;
          applied.push(`check net${nets.length > 1 ? "s" : ""} → ${nets.map((n) => `$${n.toLocaleString()}`).join(", ")}`);
        }
        const ess = call.input.monthly_essentials;
        if (typeof ess === "number" && isFinite(ess) && ess >= 0) { next.monthlyEssentials = Math.round(ess); applied.push(`essentials → $${next.monthlyEssentials.toLocaleString()}/mo`); }
        const cush = call.input.cushion;
        if (typeof cush === "number" && isFinite(cush) && cush >= 0) { next.cushion = Math.round(cush); applied.push(`never-go-below floor → $${next.cushion.toLocaleString()}`); }
        const sav = call.input.savings_balance;
        if (typeof sav === "number" && isFinite(sav) && sav >= 0) { next.savingsBalance = Math.round(sav); applied.push(`savings → $${next.savingsBalance.toLocaleString()} (its own bucket)`); }
        if (!applied.length) return { content: "No valid money fields given.", isError: true };
        ctx.updateMoney(next);
        return { content: `Done — ${applied.join(", ")}. Safe-to-spend and the cash curve recalculated.`, friendly: `✓ Money: ${applied.join(", ")}` };
      }

      case "upsert_bill": {
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const ref = String(call.input.name ?? "").trim();
        if (!ref) return { content: "No bill name given.", isError: true };
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        let matches = cfg.bills.filter((b) => norm(b.name).includes(norm(ref)) || norm(ref).includes(norm(b.name)));
        // Duplicate names happen (field report, July 13: two bills both named
        // "Rent"). Narrow by match_day / match_amount when given; identical
        // twins fall through to the first — editing/removing "one of them" is
        // exactly what the user asked for.
        const mDay = typeof call.input.match_day === "number" ? Math.round(call.input.match_day as number) : null;
        const mAmt = typeof call.input.match_amount === "number" ? Math.abs(Math.round(call.input.match_amount as number)) : null;
        if (matches.length > 1 && mDay != null) {
          const narrowed = matches.filter((b) => b.dayOfMonth === mDay);
          if (narrowed.length) matches = narrowed;
        }
        if (matches.length > 1 && mAmt != null) {
          const narrowed = matches.filter((b) => b.amount === mAmt);
          if (narrowed.length) matches = narrowed;
        }
        if (matches.length > 1) {
          const twin = matches.every(
            (b) => norm(b.name) === norm(matches[0].name) && b.amount === matches[0].amount && b.dayOfMonth === matches[0].dayOfMonth,
          );
          if (twin) {
            matches = [matches[0]];
          } else {
            return {
              content: `Multiple bills match "${ref}": ${matches
                .map((b) => `${b.name} $${b.amount.toLocaleString()}${b.dayOfMonth ? ` on the ${b.dayOfMonth}` : ""}`)
                .join("; ")}. Call upsert_bill again with match_amount and/or match_day to target the right one.`,
              isError: true,
            };
          }
        }
        const existing = matches[0];
        if (call.input.remove === true) {
          if (!existing) return { content: `No bill matches "${ref}" to remove. Current bills: ${cfg.bills.map((b) => b.name).join(", ") || "none"}.`, isError: true };
          ctx.updateMoney({ ...cfg, bills: cfg.bills.filter((b) => b.id !== existing.id) });
          return { content: `Done — ${existing.name} removed. Monthly bills recalculated.`, friendly: `✓ Bill removed: ${existing.name}` };
        }
        const amount = typeof call.input.amount === "number" && isFinite(call.input.amount as number) ? Math.abs(Math.round(call.input.amount as number)) : existing?.amount;
        if (!amount) return { content: "A dollar amount is needed to add a bill.", isError: true };
        const bill: Bill = {
          id: existing?.id ?? `b${Date.now().toString(36)}`,
          name: existing && !call.input.amount ? existing.name : (existing?.name ?? ref),
          amount,
          cadence: (typeof call.input.cadence === "string" && ["monthly", "weekly", "biweekly", "quarterly", "yearly"].includes(call.input.cadence as string)
            ? (call.input.cadence as Bill["cadence"])
            : existing?.cadence ?? "monthly"),
          dayOfMonth: typeof call.input.day_of_month === "number" ? Math.min(31, Math.max(1, Math.round(call.input.day_of_month as number))) : existing?.dayOfMonth,
          isSubscription: typeof call.input.is_subscription === "boolean" ? (call.input.is_subscription as boolean) : existing?.isSubscription,
          isDebt: typeof call.input.is_debt === "boolean" ? (call.input.is_debt as boolean) : existing?.isDebt,
          isSavings: typeof call.input.is_savings === "boolean" ? (call.input.is_savings as boolean) : existing?.isSavings,
        };
        const bills = existing ? cfg.bills.map((b) => (b.id === existing.id ? bill : b)) : [...cfg.bills, bill];
        ctx.updateMoney({ ...cfg, bills });
        return {
          content: `Done — ${bill.name}: $${bill.amount.toLocaleString()} ${bill.cadence}${bill.dayOfMonth ? ` around the ${bill.dayOfMonth}` : ""} ${existing ? "(updated)" : "(added)"}. Bills and safe-to-spend recalculated.`,
          friendly: `✓ Bill ${existing ? "updated" : "added"}: ${bill.name} $${bill.amount.toLocaleString()}`,
        };
      }

      case "update_goal": {
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const ref = String(call.input.name ?? "").trim();
        if (!ref) return { content: "No goal name given.", isError: true };
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const matches = cfg.goals.filter((g) => norm(g.name).includes(norm(ref)) || norm(ref).includes(norm(g.name)));
        if (matches.length > 1) return { content: `Multiple goals match "${ref}": ${matches.map((g) => g.name).join(", ")}. Ask which one.`, isError: true };
        const existing = matches[0];
        if (call.input.remove === true) {
          if (!existing) return { content: `No goal matches "${ref}".`, isError: true };
          ctx.updateMoney({ ...cfg, goals: cfg.goals.filter((g) => g.id !== existing.id) });
          return { content: `Done — the "${existing.name}" goal is removed.`, friendly: `✓ Goal removed: ${existing.name}` };
        }
        const target = typeof call.input.target === "number" && (call.input.target as number) > 0 ? Math.round(call.input.target as number) : existing?.target;
        if (!target) return { content: "A target amount is needed to create a goal.", isError: true };
        let saved = existing?.saved ?? 0;
        if (typeof call.input.saved === "number" && isFinite(call.input.saved as number)) saved = Math.max(0, Math.round(call.input.saved as number));
        if (typeof call.input.add_to_saved === "number" && isFinite(call.input.add_to_saved as number)) saved = Math.max(0, saved + Math.round(call.input.add_to_saved as number));
        const goal: MoneyGoal = {
          id: existing?.id ?? `g${Date.now().toString(36)}`,
          name: existing?.name ?? ref,
          target,
          saved,
          emoji: typeof call.input.emoji === "string" && (call.input.emoji as string).trim() ? (call.input.emoji as string).trim().slice(0, 4) : existing?.emoji,
        };
        const goals = existing ? cfg.goals.map((g) => (g.id === existing.id ? goal : g)) : [...cfg.goals, goal];
        ctx.updateMoney({ ...cfg, goals });
        const pct = Math.min(100, Math.round((goal.saved / goal.target) * 100));
        return {
          content: `Done — ${goal.name}: $${goal.saved.toLocaleString()} of $${goal.target.toLocaleString()} (${pct}%)${pct >= 100 ? " — GOAL HIT. Celebrate them." : ""}.`,
          friendly: `✓ ${goal.name}: $${goal.saved.toLocaleString()}/$${goal.target.toLocaleString()}${pct >= 100 ? " 🎉" : ""}`,
        };
      }

      case "log_spend": {
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const amount = Number(call.input.amount);
        const category = String(call.input.category ?? "").trim();
        if (!(amount > 0)) return { content: "No valid amount given.", isError: true };
        if (!category) return { content: "No category given.", isError: true };
        // Snap to an existing budget category (case-insensitive) so "food"
        // lands on "Food" instead of opening a duplicate line.
        const canon = (cfg.budgets ?? []).find((b) => b.name.trim().toLowerCase() === category.toLowerCase())?.name ?? category;
        const now = new Date();
        const next = addSpend(
          cfg,
          { amount, category: canon, note: typeof call.input.note === "string" ? call.input.note : undefined, date: typeof call.input.date === "string" ? call.input.date : undefined },
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
          () => `s${Date.now().toString(36)}`,
        );
        ctx.updateMoney(next);
        const bm = budgetMonth(next, now);
        const line = bm?.lines.find((l) => l.name.trim().toLowerCase() === canon.toLowerCase());
        const catNote = line && line.budget > 0
          ? line.left >= 0
            ? ` ${canon}: $${line.actual.toLocaleString()} of $${line.budget.toLocaleString()} used ($${line.left.toLocaleString()} left).`
            : ` ${canon} is now $${Math.abs(line.left).toLocaleString()} OVER its $${line.budget.toLocaleString()} budget.`
          : ` ${canon} has no budget set — it shows as unplanned spend.`;
        const monthNote = bm && bm.totalBudget > 0
          ? bm.leftToSpend >= 0
            ? ` Month: $${bm.leftToSpend.toLocaleString()} left to spend, ${bm.daysLeft} days to go.`
            : ` Month: $${Math.abs(bm.leftToSpend).toLocaleString()} over budget with ${bm.daysLeft} days to go.`
          : "";
        return {
          content: `Logged — $${Math.round(amount).toLocaleString()} on ${canon}.${catNote}${monthNote}`,
          friendly: `✓ Logged $${Math.round(amount).toLocaleString()} — ${canon}`,
        };
      }

      case "remove_spend": {
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const log = cfg.spend ?? [];
        if (!log.length) return { content: "The spend log is empty — nothing to remove.", isError: true };
        const norm = (x: string) => x.trim().toLowerCase();
        const amt = typeof call.input.amount === "number" && isFinite(call.input.amount as number) ? Math.round(Math.abs(call.input.amount as number)) : null;
        const cat = typeof call.input.category === "string" && (call.input.category as string).trim() ? norm(call.input.category as string) : null;
        const noteQ = typeof call.input.note_contains === "string" && (call.input.note_contains as string).trim() ? norm(call.input.note_contains as string) : null;
        const date = typeof call.input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(call.input.date as string) ? (call.input.date as string) : null;
        const id = typeof call.input.entry_id === "string" && (call.input.entry_id as string).trim() ? (call.input.entry_id as string).trim() : null;
        const matches = log.filter((e) =>
          (id ? e.id === id : true) &&
          (amt != null ? Math.round(e.amount) === amt : true) &&
          (cat ? norm(e.category).includes(cat) || cat.includes(norm(e.category)) : true) &&
          (noteQ ? norm(e.note ?? "").includes(noteQ) : true) &&
          (date ? e.date === date : true),
        );
        const describe = (e: (typeof log)[number]) => `$${Math.round(e.amount).toLocaleString()} ${e.category} on ${e.date}${e.note ? ` ("${e.note}")` : ""} [id ${e.id}]`;
        if (!matches.length) {
          return { content: `No logged entry matches that. Recent log (newest first): ${[...log].reverse().slice(0, 6).map(describe).join("; ")}. Ask which one, or call remove_spend with its entry_id.`, isError: true };
        }
        if (matches.length > 1) {
          return { content: `${matches.length} entries match: ${matches.map(describe).join("; ")}. Ask the user which one(s), then remove each by entry_id (one call per entry).`, isError: true };
        }
        const gone = matches[0];
        const next = removeSpend(cfg, gone.id);
        ctx.updateMoney(next);
        const bm = budgetMonth(next, new Date());
        const monthNote = bm && bm.totalBudget > 0
          ? bm.leftToSpend >= 0
            ? ` Budget now: $${bm.leftToSpend.toLocaleString()} left to spend.`
            : ` Budget now: $${Math.abs(bm.leftToSpend).toLocaleString()} over.`
          : "";
        return {
          content: `Removed — ${describe(gone)}. The budget, ledger, and daily number recalculated.${monthNote}`,
          friendly: `✓ Removed $${Math.round(gone.amount).toLocaleString()} ${gone.category}`,
        };
      }

      case "reclassify_spending": {
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const merchant = String(call.input.merchant ?? "").trim();
        const kind = String(call.input.kind ?? "").trim() as "everyday" | "bill" | "debt" | "ignore" | "remove";
        if (!merchant) return { content: "Which merchant? Give the name as it shows on the synced line.", isError: true };
        if (!["everyday", "bill", "debt", "ignore", "remove"].includes(kind)) {
          return { content: "kind must be one of: everyday, bill, debt, ignore, remove.", isError: true };
        }
        const category = typeof call.input.category === "string" && (call.input.category as string).trim() ? (call.input.category as string).trim() : undefined;
        const now = new Date();
        const next = setMerchantRule(cfg, merchant, kind, category, now.toISOString());
        ctx.updateMoney(next);
        const label =
          kind === "remove" ? "back to automatic"
          : kind === "everyday" ? `everyday spending${category ? ` (${category})` : ""}`
          : kind === "ignore" ? "not spending — a transfer between their own accounts"
          : kind === "bill" ? "a bill"
          : "debt / a loan payment";
        const bm = budgetMonth(next, now);
        const monthNote = bm && bm.totalBudget > 0
          ? bm.leftToSpend >= 0
            ? ` Budget now: $${bm.leftToSpend.toLocaleString()} left to spend this month.`
            : ` Budget now: $${Math.abs(bm.leftToSpend).toLocaleString()} over.`
          : "";
        return {
          content: `Done — ${merchant} is now ${label}, applied to every past and future charge. I'll remember it.${monthNote}`,
          friendly: `✓ ${merchant} → ${label}`,
        };
      }

      case "set_transaction_account": {
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const merchant = String(call.input.merchant ?? "").trim();
        const acctQuery = String(call.input.account ?? "").trim();
        if (!merchant) return { content: "Which purchase? Give the merchant name as it shows on the line.", isError: true };
        const accounts = cfg.linkedAccounts ?? [];
        if (!accounts.length) {
          return { content: "No accounts are set up yet — add your banks on the Money tab first (the 'Your accounts' card), then I can tag purchases to them.", isError: true };
        }
        const list = () => accounts.map((a) => `${a.institution} ${a.name}${a.mask ? ` ····${a.mask}` : ""}`).join(", ");
        const clearing = /^(none|clear|unknown|remove|unset)$/i.test(acctQuery);
        let accountId: string | undefined;
        if (!clearing) {
          if (!acctQuery) return { content: `Which account? You have: ${list()}.`, isError: true };
          const words = acctQuery.toLowerCase().split(/\s+/).filter(Boolean);
          const matches = accounts.filter((a) => {
            const hay = `${a.institution} ${a.name} ${a.mask ?? ""} ${a.type} ${a.type === "credit" ? "card" : ""}`.toLowerCase();
            return words.every((w) => hay.includes(w));
          });
          if (matches.length === 0) return { content: `No account matches "${acctQuery}". You have: ${list()}.`, isError: true };
          if (matches.length > 1) return { content: `That could be more than one: ${matches.map((a) => `${a.institution} ${a.name}`).join(", ")}. Which one?`, isError: true };
          accountId = matches[0].id;
        }
        const key = merchantKeyFor(merchant);
        const hit = (cfg.spend ?? []).find((e) => merchantKeyFor(e.note || e.category) === key);
        const entry = hit ?? { id: "", source: "bank" as const, note: merchant, category: merchant };
        const next = setSpendAccount(cfg, entry, accountId, new Date().toISOString());
        ctx.updateMoney(next);
        if (clearing) {
          return { content: `Cleared the account on ${merchant}.`, friendly: `✓ ${merchant} · account cleared` };
        }
        const label = accountLabelFor(next, accountId) ?? "that account";
        const remembers = (entry.source === "bank") ? " I'll remember that for every charge from them." : "";
        return {
          content: `Got it — ${merchant} is set to ${label}.${remembers}`,
          friendly: `✓ ${merchant} → ${label}`,
        };
      }

      case "set_budget": {
        const cfg = ctx.profile.money ?? defaultMoneyConfig();
        const category = String(call.input.category ?? "").trim();
        if (!category) return { content: "No category given.", isError: true };
        if (call.input.remove === true) {
          const existing = (cfg.budgets ?? []).find((b) => b.name.trim().toLowerCase() === category.toLowerCase());
          if (!existing) return { content: `No budget category matches "${category}". Current: ${(cfg.budgets ?? []).map((b) => b.name).join(", ") || "none"}.`, isError: true };
          ctx.updateMoney(upsertBudget(cfg, existing.name, null));
          return { content: `Done — the ${existing.name} budget is removed.`, friendly: `✓ Budget removed: ${existing.name}` };
        }
        const monthly = Number(call.input.monthly);
        if (!(monthly > 0)) return { content: "A monthly dollar amount is needed to set a budget.", isError: true };
        const next = upsertBudget(cfg, category, monthly);
        ctx.updateMoney(next);
        const total = (next.budgets ?? []).reduce((s, b) => s + b.monthly, 0);
        return {
          content: `Done — ${category} budget is $${Math.round(monthly).toLocaleString()}/mo. Total planned spending: $${total.toLocaleString()}/mo across ${next.budgets!.length} categor${next.budgets!.length === 1 ? "y" : "ies"}.`,
          friendly: `✓ Budget: ${category} $${Math.round(monthly).toLocaleString()}/mo`,
        };
      }

      case "evaluate_purchase": {
        const cfg = ctx.profile.money;
        const amount = Number(call.input.amount);
        if (!cfg || cfg.checkingBalance == null) {
          return { content: "The user's Money picture isn't set up (no balance entered) — you can't run the math. Invite them to the Money tab: balance + bills takes two minutes, then you can answer this for real.", isError: true };
        }
        if (!(amount > 0)) return { content: "No valid purchase amount given.", isError: true };
        const now = new Date();
        const f = forecast(ctx.profile.plan, ctx.deals, now, ctx.profile.daysOff ?? []);
        const income = incomeExpectation(f.likely.grossPay, cfg.paydays ?? cfg.payday, now, ctx.profile.plan.taxRate, cfg.checkNets);
        const avgPerDeal = f.counted.length > 0 ? f.current.grossPay / f.counted.length : 0;
        const v = evaluatePurchase(cfg, income, now, amount, avgPerDeal);
        if (!v) return { content: "Couldn't compute a verdict.", isError: true };
        const label = String(call.input.label ?? "this purchase");
        const verdictLine =
          v.verdict === "wait"
            ? `WAIT — it doesn't fit today's cash, but the ~$${income.nextCheckAmount.toLocaleString()} check on ${v.waitUntil} covers it. Buying AFTER that check lands keeps the whole month above water. This is timing, not "can't afford it".`
            : v.verdict.toUpperCase();
        return {
          content: `Verdict data for ${label} ($${v.amount.toLocaleString()}): ${verdictLine}. Safe-to-spend now: $${v.safeAvailable.toLocaleString()} (cash on hand only); after buying: $${v.afterPurchase.toLocaleString()}. Costs ~${v.dealsOfWork || "?"} average deals of work. Month's low point if bought today: ${v.lowAfter != null ? `$${v.lowAfter.toLocaleString()}` : "unknown"} (their never-go-below floor is $${v.floor.toLocaleString()} — the verdict already respects it). Next check: ~$${income.nextCheckAmount.toLocaleString()} in ${v.daysToIncome} days${income.remainingThisMonth > 0 ? `; $${income.remainingThisMonth.toLocaleString()} still coming this month` : ""}. Deliver this straight, in your voice — lead with the answer.`,
          friendly: `✓ Ran the numbers on ${label}`,
        };
      }

      case "report_issue": {
        const res = await fetch("/api/ila/report", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(ctx.authToken ? { Authorization: `Bearer ${ctx.authToken}` } : {}) },
          body: JSON.stringify({ summary: call.input.summary, details: call.input.details }),
        });
        if (!res.ok) return { content: "Filing failed — tell the user to also mention this to support directly.", isError: true };
        const rep = (await res.json().catch(() => ({}))) as { delivered?: boolean };
        // Be honest about delivery. This route forwards to Aaron's team alert
        // channel (currently Slack). If the channel didn't confirm, say it's
        // logged but delivery is unconfirmed — never claim "they got it".
        if (rep.delivered === false) {
          return {
            content: "Logged on our end, but the team's alert channel did not confirm delivery. Tell the user it's recorded and, so it isn't missed, to also flag it to Aaron directly. Do NOT claim it reached anyone yet.",
            friendly: "✓ Logged (delivery unconfirmed)",
          };
        }
        return { content: "Filed with Aaron's team and delivered to their alert channel, with full context.", friendly: "✓ Filed to Aaron's team" };
      }

      case "set_pay_goal": {
        const plan = ctx.profile.plan;
        const th = call.input.takeHome != null ? Math.max(0, Math.round(Number(call.input.takeHome))) : undefined;
        const units = call.input.units != null ? Math.max(0, Math.round(Number(call.input.units))) : undefined;
        if (th == null && units == null) return { content: "No goal amount was given — ask for a dollar take-home target and/or a vehicle count.", isError: true };
        const next: PayPlan = {
          ...plan,
          ...(th != null ? { takeHomeGoal: th || undefined } : {}),
          ...(units != null ? { goalUnits: units } : {}),
        };
        ctx.updatePlan(next);
        const parts: string[] = [];
        if (th != null) parts.push(th > 0 ? `$${th.toLocaleString()} take-home` : "no take-home goal");
        if (units != null) parts.push(`${units} ${units === 1 ? "unit" : "units"}`);
        return { content: `Done — monthly goal set: ${parts.join(" + ")}. The Climb and the pace tracker now measure against it.`, friendly: `✓ Goal: ${parts.join(" + ")}` };
      }

      case "update_plan_config": {
        const plan = ctx.profile.plan;
        const next: PayPlan = { ...plan, base: { ...plan.base } };
        const applied: string[] = [];
        const take = (k: string, max: number): number | undefined => {
          if (call.input[k] == null) return undefined;
          const v = Number(call.input[k]);
          if (!isFinite(v) || v < 0 || v > max) throw new Error(`${k} must be a number between 0 and ${max}.`);
          return v;
        };
        try {
          const tax = take("tax_rate", 60);
          if (tax !== undefined) { next.taxRate = tax; applied.push(`tax → ${tax}%`); }
          const draw = take("draw", 100_000);
          if (draw !== undefined) {
            next.draw = draw > 0 ? { amount: draw, period: plan.draw?.period ?? "monthly", recoverable: plan.draw?.recoverable ?? true } : undefined;
            applied.push(draw > 0 ? `draw → $${draw.toLocaleString()}/mo` : "draw removed");
          }
          const carried = take("draw_carried_in", 1_000_000);
          if (carried !== undefined) { next.drawCarriedIn = carried || undefined; applied.push(carried > 0 ? `carried draw balance → $${carried.toLocaleString()}` : "carried balance cleared"); }
          const guar = take("guarantee", 1_000_000);
          if (guar !== undefined) { next.guaranteeFloor = guar || undefined; applied.push(guar > 0 ? `guarantee → $${guar.toLocaleString()}` : "guarantee cleared"); }
          const fp = take("front_pct", 100);
          if (fp !== undefined) { next.base.frontPct = fp; applied.push(`front commission → ${fp}%`); }
          const bp = take("back_pct", 100);
          if (bp !== undefined) { next.base.backPct = bp; applied.push(`back commission → ${bp}%`); }
          const pu = take("per_unit", 100_000);
          if (pu !== undefined) { next.base.perUnit = pu; applied.push(`per-unit → $${pu.toLocaleString()}`); }
          const pp = take("per_product", 100_000);
          if (pp !== undefined) { next.base.perProduct = pp; applied.push(`per-product → $${pp.toLocaleString()}`); }
          const sal = take("salary", 1_000_000);
          if (sal !== undefined) { next.base.salary = sal; applied.push(`salary → $${sal.toLocaleString()}/mo`); }
        } catch (e) {
          return { content: e instanceof Error ? e.message : "Invalid plan value.", isError: true };
        }
        if (!applied.length) return { content: "No valid plan fields given.", isError: true };
        next.type = classifyPlan(next);
        ctx.updatePlan(next);
        return {
          content: `Done — ${applied.join(", ")}. Pay recalculated (this changed plan SETTINGS, not the math engine). If their plan document changed wholesale, suggest re-uploading it in Settings for a full re-read.`,
          friendly: `✓ Plan: ${applied.join(", ")}`,
        };
      }

      case "clear_sample_data": {
        const count = ctx.deals.filter((d) => d.demo).length;
        if (!count) return { content: "No sample data on the board — everything shown is their real deals.", isError: true };
        ctx.clearSampleData();
        return {
          content: `Done — ${count} sample deal${count === 1 ? "" : "s"} cleared. The board now shows only real deals; profile and plan untouched.`,
          friendly: "✓ Sample data cleared",
        };
      }

      case "forget_memory": {
        const q = String(call.input.contains ?? "").trim().toLowerCase();
        if (!ctx.memories.length) return { content: "No memory notes are stored — nothing to forget.", isError: true };
        if (!q) return { content: "Say which note to forget (words it contains).", isError: true };
        const describe = (m: IlaMemory) => `"${m.note}" [id ${m.id}]`;
        const byId = ctx.memories.find((m) => m.id === q);
        const matches = byId ? [byId] : ctx.memories.filter((m) => m.note.toLowerCase().includes(q));
        if (!matches.length) {
          return { content: `No note contains "${call.input.contains}". Stored notes: ${ctx.memories.slice(0, 10).map(describe).join("; ")}.`, isError: true };
        }
        if (matches.length > 1) {
          return { content: `${matches.length} notes match: ${matches.map(describe).join("; ")}. Ask the user which, then call again with its exact id.`, isError: true };
        }
        ctx.forgetIlaMemory(matches[0].id);
        return { content: `Forgotten — the note "${matches[0].note}" is deleted. Acknowledge the correction briefly; don't over-apologize.`, friendly: "✓ Forgot that" };
      }

      default:
        return { content: `Unknown tool ${call.name}.`, isError: true };
    }
  } catch (e) {
    return { content: `Tool failed: ${e instanceof Error ? e.message : "unknown error"}`, isError: true };
  }
}

function cleanTime(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function displayTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h || 0, m || 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
