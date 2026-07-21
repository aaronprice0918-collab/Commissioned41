"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMission } from "@/lib/store";
import { AppShell } from "@/components/AppShell";
import { DealDetail } from "@/components/DealDetail";

export default function DealPage() {
  const { data, ready } = useMission();
  const router = useRouter();
  const params = useParams<{ id: string }>();

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
    <AppShell active="pipeline">
      <DealDetail id={String(params.id)} />
    </AppShell>
  );
}
