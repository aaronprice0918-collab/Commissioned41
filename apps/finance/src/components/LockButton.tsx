"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LockButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function lock() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={lock}
      disabled={busy}
      title="Lock"
      aria-label="Lock"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-[var(--text-dim)] transition hover:border-white/25 hover:text-white disabled:opacity-50"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </button>
  );
}
