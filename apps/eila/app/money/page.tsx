"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMission } from "@/lib/store";
import { AppShell } from "@/components/AppShell";
import { MoneyDashboard } from "@/components/MoneyDashboard";

export default function MoneyPage() {
  const { data, ready } = useMission();
  const router = useRouter();

  useEffect(() => {
    if (ready && !data.profile) router.replace("/");
  }, [ready, data.profile, router]);

  if (!ready || !data.profile) {
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <div className="h-10 w-10 animate-pulse rounded-full bg-accent/30" />
      </div>
    );
  }

  return (
    <AppShell active="money" wide>
      <MoneyDashboard />
    </AppShell>
  );
}
