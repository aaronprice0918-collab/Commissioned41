"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, CalendarDays, CheckCircle2, ChevronRight, Circle, Clock, ListChecks, PhoneCall, Plus, Sparkles, Trash2, Wallet } from "lucide-react";
import clsx from "clsx";
import { useMission } from "@/lib/store";
import { useAskIla } from "./AppShell";
import type { Deal, LifeItem, LifeItemKind } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";
import { statusLabel } from "@/lib/industry";
import { calculatePay, followUpQueue, forecast, localMonthKey, money, perfFromDeals } from "@/lib/engine";
import { vscIdOf } from "@/lib/fni";
import { dailyBudget, incomeExpectation } from "@/lib/money/engine";
import { defaultMoneyConfig } from "@/lib/money/types";
import { SectionTitle } from "./ui";

const KIND_LABEL: Record<LifeItemKind, string> = {
  appointment: "Appointment",
  task: "Task",
  personal: "Personal",
};

export function DayCommandCenter() {
  const { data, addLifeItem, updateLifeItem, removeLifeItem } = useMission();
  const askIla = useAskIla();
  const profile = data.profile!;
  const today = todayKey();
  const lifeItems = data.lifeItems ?? [];

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<LifeItemKind>("appointment");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");

  const model = useMemo(() => {
    const monthKey = localMonthKey(new Date().toISOString());
    const delivered = data.deals.filter((d) => d.status === "delivered" && localMonthKey(d.date) === monthKey);
    const live = data.deals.filter((d) => d.status !== "delivered" && d.status !== "dead");
    const pay = calculatePay(profile.plan, perfFromDeals(delivered, vscIdOf(profile)));
    const f = forecast(profile.plan, data.deals, new Date(), profile.daysOff ?? [], vscIdOf(profile));
    const moneyCfg = profile.money ?? defaultMoneyConfig();
    const income = incomeExpectation(f.likely.grossPay, moneyCfg.paydays ?? moneyCfg.payday, new Date(), profile.plan.taxRate, moneyCfg.checkNets);
    const dayMoney = dailyBudget(moneyCfg, income, new Date());
    const q = followUpQueue(data.deals);
    const todayItems = lifeItems.filter((i) => i.date === today).sort(sortLifeItems);
    const upcoming = lifeItems.filter((i) => i.date > today && !i.done).sort(sortLifeItems).slice(0, 5);
    const activeToday = todayItems.filter((i) => !i.done);
    const nextLife = activeToday.find((i) => i.kind === "appointment") ?? activeToday[0];
    const customerTouches = [...q.overdue, ...q.dueToday, ...q.goingCold];
    return { delivered, live, pay, f, dayMoney, todayItems, upcoming, activeToday, nextLife, customerTouches };
  }, [data.deals, lifeItems, profile, today]);

  const add = () => {
    const clean = title.trim();
    if (!clean) return;
    addLifeItem({ title: clean, kind, date, time: time || undefined });
    setTitle("");
    setTime("");
    setDate(today);
    setKind("appointment");
  };

  // Short, human hand-off — EILA already has today's life items, deals, money,
  // and customer touches in her live snapshot, so the message she "receives"
  // reads like a text, not a data dump pasted as the user.
  const dayPrompt = "Build me a simple plan for today — protect my life stuff and still move my month forward.";

  return (
    <div>
      <div className="px-1">
        <div className="text-xl font-black">Your day</div>
        <div className="text-xs text-fg/65">Life, deals, money, and reminders in one clean lane.</div>
      </div>

      <button className="glass living-ring mt-4 block w-full p-4 text-left" onClick={() => askIla(dayPrompt)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent2">
              <Sparkles size={13} /> EILA day plan
            </div>
            <div className="mt-1 text-[18px] font-black leading-tight text-fg">
              {model.nextLife
                ? [timeLabel(model.nextLife), model.nextLife.title].filter(Boolean).join(" ")
                : model.customerTouches.length
                  ? `${model.customerTouches.length} customer ${model.customerTouches.length === 1 ? "touch" : "touches"} to keep warm`
                  : "Clean board. Add what life needs from you today."}
            </div>
            <div className="mt-1 text-sm text-fg/60">
              Tap for a plan that balances your real life with your sales month.
            </div>
          </div>
          <div className="shrink-0 rounded-2xl bg-accent/12 px-3 py-2 text-center">
            <div className="text-2xl font-black tabnum text-accent">{model.activeToday.length}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-accent/80">life today</div>
          </div>
        </div>
      </button>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Link href="/pipeline" className="glass p-4 active:opacity-75">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65"><Briefcase size={12} className="text-accent2" /> Month log</div>
          <div className="mt-1 text-2xl font-black tabnum">{model.delivered.length}</div>
          <div className="text-xs text-fg/60">{money(model.pay.grossPay)} closed pay</div>
        </Link>
        <Link href={model.dayMoney ? "/money/daily" : "/money"} className="glass p-4 active:opacity-75">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65"><Wallet size={12} className="text-accent2" /> Money today</div>
          <div className="mt-1 text-2xl font-black tabnum">{model.dayMoney ? money(model.dayMoney.leftToday) : "Set up"}</div>
          <div className="text-xs text-fg/60">{model.dayMoney ? "left to spend" : "connect bills & payday"}</div>
        </Link>
      </div>

      <div className="glass mt-4 p-4">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent2/12 text-accent2"><Plus size={17} /></div>
          <div className="min-w-0">
            <div className="text-sm font-black">Add something outside the deal log</div>
            <div className="text-xs text-fg/55">Appointment, errand, family thing, workout, reminder.</div>
          </div>
        </div>
        <div className="mt-3 grid gap-2">
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you need to remember?" />
          <div className="grid grid-cols-[1fr_0.72fr] gap-2">
            <input className="field tabnum" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="field tabnum" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["appointment", "task", "personal"] as LifeItemKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={clsx("rounded-xl px-2 py-2 text-[12px] font-bold transition active:scale-95", kind === k ? "bg-accent text-white" : "bg-fg/6 text-fg/65")}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button className="btn btn-primary btn-block" onClick={add}>Add to day</button>
        </div>
      </div>

      <SectionTitle action={<span className="text-xs font-semibold text-fg/45 tabnum">{model.todayItems.length}</span>}>Today</SectionTitle>
      {model.todayItems.length ? (
        <div className="space-y-2">
          {model.todayItems.map((item) => (
            <LifeRow
              key={item.id}
              item={item}
              onToggle={() => updateLifeItem(item.id, { done: !item.done })}
              onRemove={() => removeLifeItem(item.id)}
            />
          ))}
        </div>
      ) : (
        <div className="glass p-5 text-sm leading-relaxed text-fg/60">
          Nothing personal is on the board yet. Add the things that would make a salesperson say, &quot;don&apos;t let me forget this.&quot;
        </div>
      )}

      {model.upcoming.length > 0 && (
        <>
          <SectionTitle>Coming up</SectionTitle>
          <div className="space-y-2">
            {model.upcoming.map((item) => (
              <LifeRow key={item.id} item={item} onToggle={() => updateLifeItem(item.id, { done: !item.done })} onRemove={() => removeLifeItem(item.id)} compact />
            ))}
          </div>
        </>
      )}

      <SectionTitle action={<Link href="/pipeline" className="text-xs font-bold text-accent2">All deals</Link>}>Recent deal cards</SectionTitle>
      {model.delivered.length ? (
        <div className="space-y-2">
          {model.delivered.slice(0, 5).map((d) => <DealRow key={d.id} deal={d} />)}
        </div>
      ) : (
        <div className="glass p-5 text-sm text-fg/60">No delivered deals logged this month yet. The first logged deal starts the monthly receipt.</div>
      )}

      {model.customerTouches.length > 0 && (
        <>
          <SectionTitle>Customer touches</SectionTitle>
          <div className="glass divide-y divide-fg/5 p-1">
            {model.customerTouches.slice(0, 4).map((d) => (
              <Link key={d.id} href={`/deal/${d.id}`} className="flex items-center justify-between gap-3 px-3 py-3 active:opacity-70">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{d.customer || "Customer"}</span>
                  <span className="block truncate text-xs text-fg/55">{statusLabel(profile.industry, d.status, STATUS_LABEL[d.status])} / handle inside your sales flow</span>
                </span>
                <PhoneCall size={15} className="shrink-0 text-accent2" />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LifeRow({ item, onToggle, onRemove, compact }: { item: LifeItem; onToggle: () => void; onRemove: () => void; compact?: boolean }) {
  const icon = item.done ? <CheckCircle2 size={18} /> : item.kind === "appointment" ? <CalendarDays size={18} /> : item.kind === "task" ? <ListChecks size={18} /> : <Circle size={18} />;
  return (
    <div className={clsx("glass flex items-center gap-3 p-3.5", item.done && "opacity-60")}>
      <button onClick={onToggle} className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl active:scale-95", item.done ? "bg-good/15 text-good" : "bg-accent/10 text-accent2")} aria-label={item.done ? "Mark not done" : "Mark done"}>
        {icon}
      </button>
      <div className="min-w-0 flex-1">
        <div className={clsx("truncate font-bold", item.done && "line-through")}>{item.title}</div>
        <div className="flex items-center gap-1.5 truncate text-xs text-fg/55">
          <Clock size={12} /> {item.date === todayKey() && !compact ? "Today" : niceDate(item.date)}{item.time ? ` / ${displayTime(item.time)}` : ""} / {KIND_LABEL[item.kind]}
        </div>
      </div>
      <button onClick={onRemove} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg/45 active:scale-95" aria-label="Remove">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function DealRow({ deal }: { deal: Deal }) {
  return (
    <Link href={`/deal/${deal.id}`} className="glass flex items-center justify-between gap-3 p-3.5 active:opacity-75">
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{deal.customer || "Customer"}</span>
        <span className="block truncate text-xs text-fg/60">{deal.item || "Deal"} / {new Date(deal.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-black tabnum text-good">
        {money(deal.amount + deal.secondary)} <ChevronRight size={14} />
      </span>
    </Link>
  );
}

function sortLifeItems(a: LifeItem, b: LifeItem) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return (a.time || "99:99").localeCompare(b.time || "99:99");
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function niceDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function displayTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h || 0, m || 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function timeLabel(item: LifeItem) {
  return item.time ? displayTime(item.time) : "";
}
