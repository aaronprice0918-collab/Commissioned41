"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users, DollarSign, Gift, Clock, TrendingUp, Sparkles } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { OwnerIlaChat } from "@/components/OwnerIlaChat";
import { CountUp } from "@/components/motion";

// The Owner Pulse — Aaron's private growth board. Locked server-side to the
// owner; a non-owner who somehow lands here just sees "not available".

interface Person { email: string; created: string; lastSignIn: string | null; status: string }
interface Pulse {
  summary: { real: number; internal: number; paying: number; trial: number; team: number; free: number; activeToday: number; active7: number; quiet: number };
  spark: { day: string; n: number }[];
  people: Person[];
}

const STATUS: Record<string, { label: string; cls: string }> = {
  owner: { label: "You", cls: "bg-accent2/20 text-accent2" },
  paying: { label: "Paying", cls: "bg-good/15 text-good" },
  trial: { label: "Trial", cls: "bg-accent2/15 text-accent2" },
  team: { label: "Team", cls: "bg-accent/15 text-accent" },
  free: { label: "No access yet", cls: "bg-fg/8 text-fg/50" },
};

export default function OwnerPage() {
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">("loading");
  const [data, setData] = useState<Pulse | null>(null);
  const [ownerEmail, setOwnerEmail] = useState("Aaron");

  useEffect(() => {
    (async () => {
      try {
        const sb = getSupabase();
        const session = sb ? (await sb.auth.getSession()).data.session : undefined;
        const token = session?.access_token;
        if (session?.user?.email) setOwnerEmail(session.user.email.split("@")[0]);
        if (!token) { setState("denied"); return; }
        const res = await fetch("/api/owner/pulse", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401 || res.status === 403) { setState("denied"); return; }
        if (!res.ok) { setState("error"); return; }
        setData(await res.json());
        setState("ok");
      } catch { setState("error"); }
    })();
  }, []);

  if (state === "loading") {
    return <div className="grid min-h-[100dvh] place-items-center"><div className="h-10 w-10 animate-pulse rounded-full bg-accent/30" /></div>;
  }
  if (state === "denied") {
    return (
      <div className="grid min-h-[100dvh] place-items-center px-6 text-center">
        <div>
          <div className="text-sm text-fg/60">This page is for the owner only.</div>
          <Link href="/" className="mt-3 inline-block text-accent">Back to EILA</Link>
        </div>
      </div>
    );
  }
  if (state === "error" || !data) {
    return <div className="grid min-h-[100dvh] place-items-center text-sm text-fg/50">Couldn&apos;t load the pulse — try again.</div>;
  }

  const s = data.summary;
  const maxSpark = Math.max(1, ...data.spark.map((d) => d.n));

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-app px-4 pb-16 pt-6">
      <div className="flex items-center justify-between px-1">
        <Link href="/" className="flex items-center gap-1.5 text-sm font-semibold text-fg/50 active:scale-95"><ArrowLeft size={16} /> Back</Link>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent2"><Sparkles size={12} /> Owner</span>
      </div>

      <h1 className="mt-2 px-1 font-display text-2xl font-black">Your Pulse</h1>
      <p className="px-1 text-sm text-fg/70">{s.real} real {s.real === 1 ? "person" : "people"} so far{s.internal ? ` · ${s.internal} internal/test hidden` : ""}</p>

      {/* Aaron's own assistant — talks about the business, not any rep's month */}
      <div className="mt-4">
        <OwnerIlaChat name={ownerEmail} />
      </div>

      {/* Headline cards */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Card icon={<Users size={14} />} tone="text-accent2" label="Total people" value={s.real} hint={`${s.activeToday} active today`} delayMs={0} />
        <Card icon={<DollarSign size={14} />} tone="text-good" label="Paying" value={s.paying} hint={s.trial ? `+${s.trial} on trial` : "of your team"} delayMs={60} />
        <Card icon={<Gift size={14} />} tone="text-accent" label="Team (free)" value={s.team} hint="via your links" delayMs={120} />
        <Card icon={<Clock size={14} />} tone="text-fg/50" label="Active this week" value={s.active7} hint={s.quiet ? `${s.quiet} gone quiet` : "everyone's engaged"} delayMs={180} />
      </div>

      {/* Signups sparkline, 14 days */}
      <div className="glass rise mt-3 p-4" style={{ animationDelay: "240ms" }}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/65"><TrendingUp size={13} /> Signups · last 14 days</div>
        <div className="mt-3 flex h-20 items-end gap-1">
          {data.spark.map((d, i) => (
            <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${d.n}`}>
              {d.n > 0 && <span className="text-[10px] font-bold text-fg/60 tabnum">{d.n}</span>}
              <div
                className="sparkbar w-full rounded-t bg-gradient-to-t from-accent/40 to-accent"
                style={{ "--bar-h": `${Math.max(d.n ? 8 : 2, (d.n / maxSpark) * 100)}%`, animationDelay: `${280 + i * 25}ms` } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
      </div>

      {/* People */}
      <div className="glass mt-3 divide-y divide-fg/5 p-1">
        {data.people.length === 0 && <div className="p-6 text-center text-sm text-fg/65">No signups yet — share your link.</div>}
        {data.people.map((p, i) => {
          const st = STATUS[p.status] ?? STATUS.free;
          const last = p.lastSignIn ? timeAgo(p.lastSignIn) : "never signed in";
          return (
            <div key={p.email} className="rise flex items-center gap-3 px-3 py-2.5" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.email}</div>
                <div className="text-[11px] text-fg/65">joined {new Date(p.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {last}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function Card({ icon, tone, label, value, hint, delayMs = 0 }: { icon: React.ReactNode; tone: string; label: string; value: number; hint: string; delayMs?: number }) {
  return (
    <div className="glass rise p-4" style={{ animationDelay: `${delayMs}ms` }}>
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${tone}`}>{icon} {label}</div>
      <CountUp value={value} className="mt-1 block text-[26px] font-black leading-tight" />
      <div className="mt-0.5 text-[11px] text-fg/65">{hint}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "active just now";
  if (h < 24) return `active ${h}h ago`;
  const d = Math.floor(h / 24);
  return `active ${d}d ago`;
}
