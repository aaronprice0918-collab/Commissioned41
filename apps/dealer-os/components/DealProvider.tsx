"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type Deal } from "@/lib/data";
import { applyImport, type ImportMode } from "@/lib/dealImport";
import { loadStore, saveStoreGuarded } from "@/lib/storeClient";

type DealContextValue = {
  deals: Deal[];
  // False until the first server read lands — screens must show a loading
  // state, never present the empty defaults as real numbers.
  loaded: boolean;
  addDeal: (deal: Deal) => void;
  updateDeal: (dealId: string, updates: Partial<Deal>) => void;
  deleteDeal: (dealId: string) => void;
  clearDeals: () => void;
  // Bulk intake from the Import screen. "replace" swaps the whole month in;
  // "add" prepends a batch; "merge" enriches existing deals by deal number (a
  // rich grid layered onto product-blind deals). One state update -> one persist.
  importDeals: (incoming: Deal[], mode: ImportMode) => void;
  // Verified whole-board write: the server save is CONFIRMED before local state
  // changes. Bulk operations (import, restore-from-backup) use this so "Done"
  // can never be claimed for a write that didn't land.
  replaceBoardVerified: (next: Deal[]) => Promise<boolean>;
  // True while the background persist of the board is failing (after a retry).
  // Surfaced as a banner so a dropped save is never silent.
  saveFailed: boolean;
};

const DealContext = createContext<DealContextValue | null>(null);

export function DealProvider({ children }: { children: React.ReactNode }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // A compare-and-swap save was rejected because another device wrote first —
  // the board reloaded to the current copy and the user's last edit needs
  // re-entering. Surfaced as its own banner (it is NOT a connection problem).
  const [conflicted, setConflicted] = useState(false);
  // Every LOCAL mutation bumps this and marks the change as needing a persist.
  // Server refreshes (initial load, focus reload) do neither — so a refresh can
  // never echo server data back as a write, and a refresh response that raced a
  // local edit is thrown away instead of clobbering it.
  const mutationSeq = useRef(0);
  const needsPersist = useRef(false);

  function markLocalChange() {
    mutationSeq.current += 1;
    needsPersist.current = true;
  }

  function applyServerCopy(saved: Deal[] | null, seqAtRequest: number) {
    if (!Array.isArray(saved)) return;
    if (mutationSeq.current !== seqAtRequest) return; // a local edit won the race
    setDeals((current) => (JSON.stringify(current) === JSON.stringify(saved) ? current : saved));
  }

  useEffect(() => {
    const seq = mutationSeq.current;
    loadStore<Deal[]>("deals").then((saved) => {
      applyServerCopy(saved, seq);
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A device that wakes back up refreshes its copy of the board BEFORE the user
  // can act on stale data. This is the guard against the clobber class: a tab
  // left open for weeks used to save its ancient board over everyone's work the
  // moment anything changed on it.
  useEffect(() => {
    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const seq = mutationSeq.current;
      void loadStore<Deal[]>("deals").then((saved) => applyServerCopy(saved, seq));
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!needsPersist.current) return; // server refresh or initial load — nothing to write
    needsPersist.current = false;
    let cancelled = false;
    // Adopt the server's copy after a rejected compare-and-swap write: another
    // device wrote first, so THIS device's board was stale. Replacing local
    // state (instead of overwriting the server) is the whole point — the one
    // local edit is lost and the banner says to redo it, but the board the
    // other device saved survives.
    const adoptConflict = (serverCopy: Deal[] | null) => {
      if (cancelled) return;
      mutationSeq.current += 1; // outrank any in-flight refresh
      needsPersist.current = false;
      if (Array.isArray(serverCopy)) setDeals(serverCopy);
      setConflicted(true);
      setSaveFailed(false);
    };
    const persist = async () => {
      const first = await saveStoreGuarded("deals", deals);
      if (first.ok) {
        if (!cancelled) {
          setSaveFailed(false);
          setConflicted(false);
        }
        return;
      }
      if (first.conflict) {
        adoptConflict(first.value);
        return;
      }
      // One quiet retry, then say so out loud. A dropped save must never be silent.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (cancelled) return;
      const retried = await saveStoreGuarded("deals", deals);
      if (retried.ok) {
        if (!cancelled) {
          setSaveFailed(false);
          setConflicted(false);
        }
        return;
      }
      if (retried.conflict) {
        adoptConflict(retried.value);
        return;
      }
      if (!cancelled) setSaveFailed(true);
    };
    void persist();
    return () => {
      cancelled = true;
    };
  }, [deals, loaded]);

  const value = useMemo(
    () => ({
      deals,
      loaded,
      saveFailed,
      addDeal: (deal: Deal) => {
        markLocalChange();
        setDeals((current) => [deal, ...current]);
      },
      updateDeal: (dealId: string, updates: Partial<Deal>) => {
        markLocalChange();
        setDeals((current) => current.map((deal) => (deal.id === dealId ? { ...deal, ...updates } : deal)));
      },
      deleteDeal: (dealId: string) => {
        markLocalChange();
        setDeals((current) => current.filter((deal) => deal.id !== dealId));
      },
      clearDeals: () => {
        markLocalChange();
        setDeals([]);
      },
      importDeals: (incoming: Deal[], mode: ImportMode) => {
        markLocalChange();
        setDeals((current) => applyImport(current, incoming, mode));
      },
      replaceBoardVerified: async (next: Deal[]) => {
        const saved = await saveStoreGuarded("deals", next);
        if (!saved.ok) {
          // A conflict here means the board changed under a bulk operation
          // (import/restore). Refresh so the caller's next attempt sees — and
          // compare-and-swaps against — the current copy.
          if (saved.conflict && Array.isArray(saved.value)) {
            mutationSeq.current += 1;
            needsPersist.current = false;
            setDeals(saved.value);
          }
          return false;
        }
        // The server copy IS next now; adopt it locally without re-persisting.
        mutationSeq.current += 1;
        setDeals(next);
        setSaveFailed(false);
        setConflicted(false);
        return true;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, loaded, saveFailed]
  );

  return (
    <DealContext.Provider value={value}>
      {children}
      {saveFailed && (
        <div className="fixed inset-x-0 bottom-0 z-[120] border-t border-mission-red/40 bg-mission-red/95 px-4 py-3 text-center text-sm font-bold text-white">
          Couldn&apos;t save your latest deal changes — check your connection. Your edits are still on this screen; they&apos;ll save when the connection returns.
        </div>
      )}
      {conflicted && (
        <button
          type="button"
          onClick={() => setConflicted(false)}
          className="fixed inset-x-0 bottom-0 z-[120] border-t border-mission-gold/50 bg-mission-navy/95 px-4 py-3 text-center text-sm font-bold text-white"
        >
          The board changed on another device, so this screen reloaded to the latest copy. Your last change here wasn&apos;t saved — please re-enter it. (Tap to dismiss)
        </button>
      )}
    </DealContext.Provider>
  );
}

export function useDeals() {
  const context = useContext(DealContext);
  if (!context) {
    throw new Error("useDeals must be used inside DealProvider");
  }
  return context;
}
