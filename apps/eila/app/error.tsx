"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { MissionMark } from "@/components/Brand";

// App Router error boundary — catches any render/effect error in a route
// segment instead of showing Next's raw stack-trace overlay (dev) or a blank
// white screen (prod). There was no boundary anywhere in the app before this
// (audit finding, July 5): one bad render in any screen would take the whole
// page down with nothing for the user to do but guess. Client Component by
// Next.js's own requirement — error.tsx always renders on the client.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Best-effort client-side breadcrumb. notifyFailure() (lib/alert.ts) isn't
    // reachable from here — it reads a server-only env var — so this is just
    // the browser console, same as any other client error.
    console.error("[boundary]", error);
  }, [error]);

  return (
    <main className="grid min-h-[100dvh] place-items-center px-5 py-10">
      <div className="glass w-full max-w-sm rounded-[26px] p-8 text-center">
        <MissionMark width={64} />
        <h1 className="mt-5 text-2xl font-black leading-tight">Something went sideways.</h1>
        <p className="mt-2 text-fg/65">
          EILA hit a snag loading this screen. Your data is safe — this is just a display hiccup.
        </p>
        <button
          onClick={reset}
          className="btn btn-primary btn-block mt-6"
        >
          <RefreshCw size={17} /> Try again
        </button>
      </div>
    </main>
  );
}
