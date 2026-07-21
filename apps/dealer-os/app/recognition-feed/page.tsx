"use client";

import { Award, Flame, Star, Trophy } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useDeals } from "@/components/DealProvider";
import { canonicalPersonName, countsTowardPpu, currency, financeLeaderboard, financeManagerNamesFromDeals, isCountableRetail, productUnits, salesLeaderboard, salespersonNamesFromDeals, unitsLabel, type Deal } from "@/lib/data";
import { askIla } from "@/lib/askIla";

type RecognitionItem = {
  name: string;
  moment: string;
  tag: string;
  tone: "gold" | "green" | "blue";
};

export default function RecognitionFeedPage() {
  const { deals } = useDeals();
  const feed = buildRecognition(deals);

  return (
    <div>
      <SectionHeader title="Recognition Feed" kicker="Culture made visible" />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Tap-to-explain: every recognition moment is a computed claim — tap it
            and EILA walks the real numbers behind it. */}
        <section className="space-y-4">
          {feed.map((item, index) => (
            <button
              key={`${item.tag}:${item.name}`}
              type="button"
              onClick={() => askIla(`Explain ${canonicalPersonName(item.name)}'s "${item.tag}" recognition — walk the real numbers behind it in plain words (${item.moment}) and flag anything that looks miscredited.`)}
              title="Tap — EILA walks the numbers behind this"
              className="glass-card block w-full rounded-[12px] p-5 text-left transition hover:border-mission-gold/30"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="grid h-14 w-14 place-items-center rounded-full border border-mission-gold/35 bg-mission-gold/10">
                    {index === 0 ? <Trophy className="h-6 w-6 text-mission-gold" /> : <Star className="h-6 w-6 text-mission-gold" />}
                  </div>
                  <div>
                    <div className="font-display text-2xl font-black text-white">{canonicalPersonName(item.name)}</div>
                    <p className="mt-1 text-sm text-white/58">{item.moment}</p>
                  </div>
                </div>
                <StatusPill tone={item.tone}>{item.tag}</StatusPill>
              </div>
            </button>
          ))}
        </section>
        <aside className="glass-card h-fit rounded-[12px] p-6">
          <Award className="h-8 w-8 text-mission-gold" />
          <div className="mt-5 font-display text-3xl font-black text-white">Recognition follows the board.</div>
          <p className="mt-4 text-sm leading-6 text-white/60">This feed uses saved deal data only. As the month updates, leadership moments update with it.</p>
          <div className="mt-6 flex items-center gap-2 text-mission-green">
            <Flame className="h-5 w-5" />
            <span className="text-sm font-black uppercase tracking-[0.18em]">Updates as the board moves</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function buildRecognition(deals: Deal[]): RecognitionItem[] {
  const delivered = deals.filter(isCountableRetail);
  if (!delivered.length) {
    return [
      {
        name: "Awaiting Deliveries",
        moment: "Recognition will populate when delivered deal records are entered.",
        tag: "Ready",
        tone: "blue",
      },
    ];
  }

  const items: (RecognitionItem | null)[] = [];

  const salesLeader = salesLeaderboard(deals, salespersonNamesFromDeals(deals))[0];
  if (salesLeader && salesLeader.units > 0) {
    items.push({
      name: salesLeader.name,
      moment: `${unitsLabel(salesLeader.units)} delivered units, ${currency(salesLeader.totalGross)} credited this month.`,
      tag: "Sales Leader",
      tone: "gold",
    });
  }

  const fiLeader = financeLeaderboard(deals, financeManagerNamesFromDeals(deals))[0];
  if (fiLeader && fiLeader.copies > 0) {
    items.push({
      name: fiLeader.name,
      moment: `${fiLeader.copies} qualified copies, ${currency(fiLeader.backGross)} back gross credited this month.`,
      tag: "F&I Leader",
      tone: "green",
    });
  }

  items.push(topProduct(deals));
  items.push(biggestDeal(deals));

  const grossLead = grossLeader(deals);
  if (grossLead && (!salesLeader || canonicalPersonName(grossLead.name) !== canonicalPersonName(salesLeader.name))) {
    items.push(grossLead);
  }

  return items.filter(Boolean) as RecognitionItem[];
}

function biggestDeal(deals: Deal[]): RecognitionItem | null {
  const top = [...deals.filter(isCountableRetail)].sort((a, b) => b.frontGross + b.backGrossReserve - (a.frontGross + a.backGrossReserve))[0];
  if (!top) return null;
  const gross = top.frontGross + top.backGrossReserve;
  if (gross <= 0) return null;
  return {
    name: top.salesperson,
    moment: `Biggest single deal of the month — ${currency(gross)} on ${top.customer}.`,
    tag: "Biggest Deal",
    tone: "gold",
  };
}

function grossLeader(deals: Deal[]): RecognitionItem | null {
  const top = [...salesLeaderboard(deals, salespersonNamesFromDeals(deals))].sort((a, b) => b.totalGross - a.totalGross)[0];
  if (!top || top.totalGross <= 0) return null;
  return {
    name: top.name,
    moment: `Most gross on the floor — ${currency(top.totalGross)} credited this month.`,
    tag: "Gross Leader",
    tone: "green",
  };
}

function topProduct(deals: Deal[]): RecognitionItem | null {
  const ready = deals.filter((deal) => isCountableRetail(deal) && countsTowardPpu(deal));
  const winner = ready
    .map((deal) => ({ deal, products: productUnits(deal) }))
    .sort((a, b) => b.products - a.products || (b.deal.frontGross + b.deal.backGrossReserve) - (a.deal.frontGross + a.deal.backGrossReserve))[0];
  if (!winner) return null;
  return {
    name: winner.deal.salesperson,
    moment: `${winner.products} product units on ${winner.deal.customer}.`,
    tag: "Product Win",
    tone: "blue",
  };
}
