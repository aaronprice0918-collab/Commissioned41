"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMission } from "@/lib/store";
import { AppShell } from "@/components/AppShell";
import { Paywall, useEntitled } from "@/components/Paywall";
import { JacketSort } from "@/components/JacketSort";

// Scan and Sort — the F&I producer's deal-jacket sorter. Finance role only
// (it sorts signed deal files); subscribers only (the scan spends real vision
// quota, and the API enforces the same gate server-side). Arriving from a deal
// card (?deal=<id>) binds the sort to that customer: their name on the header
// and on the downloaded file.
export default function JacketPage() {
  return (
    <Suspense>
      <Jacket />
    </Suspense>
  );
}

function Jacket() {
  const { data, ready, account } = useMission();
  const router = useRouter();
  const params = useSearchParams();
  const boundDeal = data.deals.find((d) => d.id === params.get("deal")) || null;
  const entitled = useEntitled(account);

  useEffect(() => {
    if (!ready) return;
    if (!data.profile) router.replace("/");
    else if (data.profile.role !== "finance") router.replace("/pipeline");
  }, [ready, data.profile, router]);

  if (!ready || !data.profile || data.profile.role !== "finance") {
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <div className="h-10 w-10 animate-pulse rounded-full bg-accent/30" />
      </div>
    );
  }

  if (entitled === false) {
    return (
      <AppShell active="pipeline">
        <Paywall />
      </AppShell>
    );
  }

  return (
    <AppShell active="pipeline">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/finance" className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg/60 active:opacity-70">
          <ArrowLeft size={16} /> Finance
        </Link>
      </div>
      <h1 className="font-display text-2xl font-black text-fg">Scan and Sort</h1>
      <p className="mb-4 mt-1 text-sm text-fg/55">The signed stack, back in your jacket order.</p>
      <JacketSort deal={boundDeal ? { id: boundDeal.id, customer: boundDeal.customer, dealNumber: boundDeal.dealNumber } : undefined} />
    </AppShell>
  );
}
