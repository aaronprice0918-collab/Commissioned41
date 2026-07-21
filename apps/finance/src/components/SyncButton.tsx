"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      await fetch("/api/plaid/sync", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={sync}
      disabled={busy}
      className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] pl-2.5 pr-3.5 text-xs text-[var(--text-dim)] transition hover:border-white/25 hover:text-white disabled:opacity-50"
    >
      <span
        className="h-2 w-2 rounded-full bg-[var(--good)]"
        style={{ boxShadow: "0 0 8px var(--good)" }}
      />
      {busy ? "Syncing…" : "Plaid synced · live"}
    </button>
  );
}
