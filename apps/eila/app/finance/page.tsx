"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMission } from "@/lib/store";
import { AppShell } from "@/components/AppShell";
import { FinancePipeline } from "@/components/FinancePipeline";

export default function FinancePage() {
  const { data, ready } = useMission();
  const router = useRouter();

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

  return (
    <AppShell active="pipeline">
      <FinancePipeline />
    </AppShell>
  );
}
