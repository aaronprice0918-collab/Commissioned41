"use client";

import { useEffect, useRef, useState } from "react";
import { ScanFace, Loader2 } from "lucide-react";
import { disableBiometric, verifyBiometric } from "@/lib/biometric";
import { useMission } from "@/lib/store";
import { Wordmark, MissionMark } from "./Brand";

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { account, signOut } = useMission();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const tried = useRef(false);

  async function unlock() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await verifyBiometric();
    setBusy(false);
    if (ok) onUnlock();
    else setFailed(true);
  }

  // auto-prompt once on mount (the OS Face ID sheet appears immediately)
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink-900 px-6 text-center">
      <div className="flex flex-col items-center">
        <MissionMark width={84} className="mb-6" />
        <Wordmark height={34} />
        <div className="living-ring mt-10 grid h-24 w-24 place-items-center rounded-[28px] bg-ink-800 text-accent">
          {busy ? <Loader2 size={34} className="animate-spin" /> : <ScanFace size={38} />}
        </div>
        <p className="mt-6 text-sm text-fg/55">
          {busy ? "Verifying…" : failed ? "Couldn't verify. Try again." : "EILA is locked"}
        </p>
        <button className="btn btn-primary mt-7 px-8" onClick={unlock} disabled={busy}>
          Unlock with Face ID
        </button>
        {/* Fallback: a broken platform credential (Face ID re-enrolled, browser
            profile reset) used to be a HARD lock-out — retry was the only
            control (July 8 audit). Signing out clears this device (the lock's
            whole job) and their password + cloud copy bring everything back.
            SIGNED-IN ONLY: for a local-only user this would just be a lock
            bypass — there's no password to re-verify who they are. */}
        {failed && account && (
          <button
            className="mt-5 text-[13px] font-semibold text-fg/55 underline-offset-2 active:opacity-70"
            onClick={async () => { disableBiometric(); if (account) await signOut(); onUnlock(); }}
          >
            Face ID not working? Sign out &amp; use your password
          </button>
        )}
      </div>
    </div>
  );
}
