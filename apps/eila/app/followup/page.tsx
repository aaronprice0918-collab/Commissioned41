"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMission } from "@/lib/store";
import { AppShell } from "@/components/AppShell";
import { DayCommandCenter } from "@/components/DayCommandCenter";

export default function FollowUpPage() {
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
    <AppShell active="day">
      <DayCommandCenter />
    </AppShell>
  );
}
