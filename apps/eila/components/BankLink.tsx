"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { Landmark, RefreshCw } from "lucide-react";
import { useMission } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";
import { applyBankSync, type BankSyncPayload } from "@/lib/money/engine";
import { defaultMoneyConfig } from "@/lib/money/types";

// Platinum VIP bank connection on the Money tab.
// Three faces: the $9.99/mo VIP pitch (not a member), the connect button
// (VIP, no bank yet), and the live card (connected: last sync + Sync now).
// OAuth banks bounce to their own login and return here with oauth_state_id;
// we resume with the SAME link token kept in sessionStorage.

const LINK_TOKEN_KEY = "eila_bank_link_token";
const LINK_TOKEN_TTL_MS = 30 * 60_000; // Plaid link tokens live ~4h; we keep 30m

// localStorage, not sessionStorage: iOS kills the standalone PWA while the
// user is off logging into their bank, and sessionStorage dies with the
// process — the OAuth return then had no token to resume with, so the flow
// silently restarted from the top every time (July 13: "added my account
// twice and it keeps asking me to connect").
function stashLinkToken(token: string) {
  try {
    localStorage.setItem(LINK_TOKEN_KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {}
}
function readLinkToken(): string | null {
  try {
    const raw = localStorage.getItem(LINK_TOKEN_KEY);
    if (!raw) return null;
    const { token, at } = JSON.parse(raw) as { token?: string; at?: number };
    if (!token || !at || Date.now() - at > LINK_TOKEN_TTL_MS) return null;
    return token;
  } catch {
    return null;
  }
}
function clearLinkToken() {
  try {
    localStorage.removeItem(LINK_TOKEN_KEY);
  } catch {}
}

async function authToken(): Promise<string | undefined> {
  const sb = getSupabase();
  return sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
}

async function bankApi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const token = await authToken();
    const res = await fetch("/api/bank", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  } catch {
    // Offline / dropped connection — callers see status 0 and SAY so
    // (silence sweep, July 13: a network rejection here vanished without a word).
    return { status: 0 };
  }
}

type Face = "loading" | "pitch" | "connect" | "connected" | "unavailable" | "signed-out" | "offline";

export function BankLink() {
  const { data, updateMoney } = useMission();
  const cfg = data.profile?.money ?? defaultMoneyConfig();

  const [face, setFace] = useState<Face>(cfg.bank ? "connected" : "loading");
  const [busy, setBusy] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isOauthReturn, setIsOauthReturn] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const receivedRedirectUri = useMemo(
    () => (isOauthReturn ? window.location.href : undefined),
    [isOauthReturn],
  );

  // Face + token bootstrap. On an OAuth return we already hold the token.
  useEffect(() => {
    let active = true;
    (async () => {
      if (typeof window !== "undefined" && window.location.search.includes("oauth_state_id=")) {
        const stored = readLinkToken();
        if (stored) {
          setLinkToken(stored);
          setIsOauthReturn(true);
          setFace("connect");
          return;
        }
      }
      const s = await bankApi({ action: "status" });
      if (!active) return;
      if (s.status === 0) return setFace("offline");
      if (s.status === 401) return setFace("signed-out");
      if (!s.vip) return setFace("pitch");
      if (!s.configured) return setFace("unavailable");
      if (s.connected || cfg.bank) return setFace("connected");
      const lt = await bankApi({ action: "link-token" });
      if (!active) return;
      if (lt.status === 0) return setFace("offline");
      if (typeof lt.link_token === "string") {
        setLinkToken(lt.link_token);
        stashLinkToken(lt.link_token);
        setFace("connect");
      } else setFace("unavailable");
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSync = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await bankApi({ action: "sync" });
      if (r.status === 0) {
        setNote("Couldn't reach the server — check your connection and tap Sync again.");
        return;
      }
      if (r.status && (r.status as number) >= 400) {
        setNote("Sync hit an error on the server — try again in a minute, or tell Claude.");
        return;
      }
      const sync = r.sync as BankSyncPayload | null | undefined;
      if (sync) {
        updateMoney(applyBankSync(cfg, sync, new Date().toISOString()));
        setFace("connected");
        const chk = sync.checking != null ? `checking $${Math.round(sync.checking).toLocaleString()}` : "no checking found";
        setNote(`Synced ✓ ${chk} · ${sync.transactions.length} recent transactions checked`);
      } else setNote("Nothing to sync yet.");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, updateMoney]);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      setBusy(true);
      try {
        const ex = await bankApi({
          action: "exchange",
          public_token: publicToken,
          institution: metadata.institution?.name ?? "Bank",
        });
        if (ex.status === 0) {
          setNote("Your bank said yes, but the connection dropped before it saved — tap Connect bank once more.");
          return;
        }
        clearLinkToken();
        if (isOauthReturn) window.history.replaceState({}, "", window.location.pathname);
        if (ex.ok !== true) {
          // The bank said yes but saving failed — say so instead of quietly
          // re-showing the connect button (never a silent failure).
          setNote("Connected at the bank, but saving failed — try Sync, or tell Claude.");
          return;
        }
        setFace("connected");
        await runSync();
      } finally {
        setBusy(false);
      }
    },
    [isOauthReturn, runSync],
  );

  const onExit = useCallback(() => {
    if (isOauthReturn) {
      clearLinkToken();
      window.history.replaceState({}, "", window.location.pathname);
      setIsOauthReturn(false);
    }
  }, [isOauthReturn]);

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess, onExit, receivedRedirectUri });

  // Back from the bank's own login — reopen Link to finish automatically.
  useEffect(() => {
    if (isOauthReturn && ready) open();
  }, [isOauthReturn, ready, open]);

  const startVipCheckout = useCallback(async () => {
    setBusy(true);
    try {
      const token = await authToken();
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ tier: "vip" }),
      });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (d.url) window.location.href = d.url;
      else setNote(d.error || "Couldn't start checkout — try again in a minute.");
    } catch {
      setNote("Couldn't reach checkout — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (face === "loading" || face === "signed-out") return null;

  if (face === "offline") {
    return (
      <div className="glass rise p-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Landmark size={16} className="text-fg/40" /> Bank connection
        </div>
        <p className="mt-1 text-xs text-fg/70">Couldn&apos;t reach the server just now — check your connection.</p>
        <button className="btn btn-ghost btn-block mt-3" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  // Never hide silently: if the bank rail isn't configured, say so (July 12 —
  // an invisible card reads as "the feature doesn't exist").
  if (face === "unavailable") {
    return (
      <div className="glass rise p-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Landmark size={16} className="text-fg/40" /> Bank connection
        </div>
        <p className="mt-1 text-xs text-fg/70">
          Almost switched on — the operator is finishing the server-side bank keys. No action needed here; the
          connect button appears on its own within a minute of the keys landing.
        </p>
      </div>
    );
  }

  if (face === "pitch") {
    return (
      <div className="glass rise border border-accent/30 bg-accent/10 p-4">
        <div className="flex items-center gap-2.5 text-sm font-bold">
          <Image src="/brand/vip-badge.svg" alt="Platinum VIP" width={34} height={34} className="select-none" />
          Platinum VIP
        </div>
        <p className="mt-1 text-xs text-fg/70">
          Connect your real bank and EILA works from live balances — no more typing your balance in. Auto-synced
          checking &amp; savings, real transactions, sharper daily numbers.
        </p>
        <button className="btn btn-primary btn-block mt-3" onClick={startVipCheckout} disabled={busy}>
          {busy ? "One sec…" : "Upgrade — $9.99/mo"}
        </button>
        {note && <p className="mt-2 text-center text-[12px] font-semibold text-warn">{note}</p>}
      </div>
    );
  }

  if (face === "connect") {
    return (
      <div className="glass rise p-4">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Landmark size={16} className="text-accent" /> Connect your bank
        </div>
        <p className="mt-1 text-xs text-fg/70">
          VIP is active. Link your bank once and your balance stays live — EILA syncs it for you.
        </p>
        <button className="btn btn-primary btn-block mt-3" onClick={() => open()} disabled={!ready || busy}>
          {busy ? "Connecting…" : !ready ? "Warming up the secure widget…" : "Connect bank"}
        </button>
        {note && <p className="mt-2 text-center text-[12px] font-semibold text-warn">{note}</p>}
      </div>
    );
  }

  // connected
  return (
    <div className="glass rise p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Landmark size={16} className="text-good" /> {cfg.bank?.institutions.join(", ") || "Bank connected"}
          </div>
          <div className="mt-0.5 text-[11px] text-fg/50">
            {note ??
              (cfg.bank?.lastSync
                ? `Last synced ${new Date(cfg.bank.lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                : "Connected")}
          </div>
        </div>
        <button className="btn btn-ghost shrink-0" onClick={runSync} disabled={busy} aria-label="Sync now">
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Sync
        </button>
      </div>
    </div>
  );
}
