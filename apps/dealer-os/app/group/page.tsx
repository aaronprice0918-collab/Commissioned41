"use client";

import { useEffect, useState } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { SectionHeader } from "@/components/SectionHeader";
import { askIla } from "@/lib/askIla";
import { currency, unitsLabel } from "@/lib/data";
import { authHeaders } from "@/lib/storeClient";
import type { GroupRollup } from "@/lib/groupReport";

type GroupResponse =
  | ({ configured: true; name: string } & GroupRollup)
  | { configured: false; reason?: string }
  | { error: string };

// Group Command — the multi-rooftop rollup. One dealer principal, several
// stores, one screen: how's the GROUP doing, and which store needs attention.
// The API decides who sees what (owner = all stores; group principals = their
// configured group); this screen just renders the answer — aggregates only,
// never customer PII.
export default function GroupPage() {
  const [data, setData] = useState<GroupResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/group", { headers: await authHeaders() });
      setData(await res.json());
    } catch {
      setData({ error: "Couldn't load the group report — try again." });
    }
    setRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, []);

  if (!data) {
    return <div className="p-6 text-sm font-bold uppercase tracking-[0.14em] text-white/40">Loading the group…</div>;
  }

  if ("error" in data) {
    return <div className="p-6 text-sm font-bold text-mission-red">{data.error}</div>;
  }

  if (!data.configured) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
        <SectionHeader title="Group Command" kicker="Every store you own, one scoreboard" icon={Building2} />
        <div className="glass-card mt-4 rounded-[16px] p-8 text-center">
          <Building2 className="mx-auto h-9 w-9 text-mission-gold" />
          <div className="mt-4 font-display text-2xl font-black text-white">One store today. Ready for more.</div>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-white/55">
            Group Command rolls every rooftop you own into one scoreboard — units, gross, PVR and PPU by store. When the
            stores in your group are on Dealer Mission OS, we switch this on for you.
          </p>
        </div>
      </div>
    );
  }

  const { name, totals, stores } = data;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <SectionHeader title={name} kicker={`Group Command · ${totals.stores} ${totals.stores === 1 ? "store" : "stores"} · live`} icon={Building2} />
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/60 transition hover:border-mission-gold/50 hover:text-mission-gold"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Group Units" value={unitsLabel(totals.units)} detail={`${totals.newUnits} new · ${totals.usedUnits} used`} tone="gold" onExplain={() => askIla("Explain the group's delivered units — which store is carrying it and which is behind?")} />
        <MetricCard label="Group Gross" value={currency(totals.gross)} detail={`${currency(totals.front)} front · ${currency(totals.back)} back`} tone="green" onExplain={() => askIla("Explain the group's total gross — front vs back by store, and where the money is being left.")} />
        <MetricCard label="Group PVR" value={currency(totals.pvr)} detail="total gross ÷ total units" tone="blue" onExplain={() => askIla("Explain the group's PVR and which stores are above or below it.")} />
        <MetricCard label="Group PPU" value={totals.ppu.toFixed(2)} detail={`F&I PVR ${currency(totals.financePvr)}`} tone="blue" onExplain={() => askIla("Explain the group's products per unit and F&I PVR — which store's F&I office needs attention?")} />
      </div>

      <div className="glass-card overflow-x-auto rounded-[16px]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
              <th className="p-4">Store</th>
              <th className="p-4 text-right">Units</th>
              <th className="p-4 text-right">Gross</th>
              <th className="p-4 text-right">Front</th>
              <th className="p-4 text-right">Back</th>
              <th className="p-4 text-right">PVR</th>
              <th className="p-4 text-right">F&amp;I PVR</th>
              <th className="p-4 text-right">PPU</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.orgId} className="border-b border-white/5 text-white/80 transition hover:bg-white/[0.03]">
                <td className="p-4 font-bold text-white">{s.name}</td>
                <td className="p-4 text-right tabular-nums">{unitsLabel(s.units)}</td>
                <td className="p-4 text-right font-bold tabular-nums text-mission-green">{currency(s.gross)}</td>
                <td className="p-4 text-right tabular-nums">{currency(s.front)}</td>
                <td className="p-4 text-right tabular-nums">{currency(s.back)}</td>
                <td className="p-4 text-right tabular-nums">{currency(s.pvr)}</td>
                <td className="p-4 text-right tabular-nums">{currency(s.financePvr)}</td>
                <td className="p-4 text-right tabular-nums">{s.ppu.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-5 text-white/35">
        Aggregates only — the group view never exposes any store customers. Ask EILA anything cross-store: “which store had
        the best F&amp;I month?”
      </p>
    </div>
  );
}
