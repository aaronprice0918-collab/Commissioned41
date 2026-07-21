"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useRouter } from "next/navigation";

// OAuth banks send the user to the bank's own login and back here with
// ?oauth_state_id=… in the URL. Link must then be re-initialized with the SAME
// link token that started the flow (kept in sessionStorage) plus the full
// return URL. Two ConnectBank instances render in demo mode; the header
// "button" variant is the designated one to resume the OAuth return.
const LINK_TOKEN_KEY = "plaid_link_token";

function storedLinkToken(): string | null {
  try {
    return sessionStorage.getItem(LINK_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function ConnectBank({ variant = "button" }: { variant?: "button" | "cta" }) {
  const router = useRouter();
  const [isOauthReturn, setIsOauthReturn] = useState(
    () =>
      variant === "button" &&
      typeof window !== "undefined" &&
      window.location.search.includes("oauth_state_id=") &&
      !!storedLinkToken(),
  );
  const [token, setToken] = useState<string | null>(() => (isOauthReturn ? storedLinkToken() : null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receivedRedirectUri = useMemo(
    () => (isOauthReturn ? window.location.href : undefined),
    [isOauthReturn],
  );

  useEffect(() => {
    if (isOauthReturn) return; // resuming with the stored token — don't mint a new one
    let active = true;
    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (d.link_token) {
          setToken(d.link_token);
          try {
            sessionStorage.setItem(LINK_TOKEN_KEY, d.link_token);
          } catch {}
        } else setError(typeof d.error === "string" ? d.error : "Couldn't start Plaid");
      })
      .catch(() => active && setError("Couldn't reach Plaid"));
    return () => {
      active = false;
    };
  }, [isOauthReturn]);

  const finishOauthReturn = useCallback(() => {
    try {
      sessionStorage.removeItem(LINK_TOKEN_KEY);
    } catch {}
    // Drop oauth_state_id from the address bar so a refresh doesn't re-resume.
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      setBusy(true);
      try {
        await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token: publicToken,
            institution: metadata.institution?.name ?? "Bank",
          }),
        });
        if (isOauthReturn) finishOauthReturn();
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [router, isOauthReturn, finishOauthReturn],
  );

  const onExit = useCallback(() => {
    if (isOauthReturn) {
      finishOauthReturn();
      setIsOauthReturn(false);
    }
  }, [isOauthReturn, finishOauthReturn]);

  const { open, ready } = usePlaidLink({ token, onSuccess, onExit, receivedRedirectUri });
  const disabled = !ready || !token || busy;

  // Back from the bank's login — reopen Link automatically to finish the job.
  useEffect(() => {
    if (isOauthReturn && ready) open();
  }, [isOauthReturn, ready, open]);

  if (error) {
    return (
      <span className="text-xs text-[var(--watch)]" title={error}>
        Plaid not ready — check keys
      </span>
    );
  }

  if (variant === "cta") {
    return (
      <button
        onClick={() => open()}
        disabled={disabled}
        className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-soft)] disabled:opacity-40"
      >
        {busy ? "Connecting…" : "Connect a bank"}
      </button>
    );
  }

  return (
    <button
      onClick={() => open()}
      disabled={disabled}
      className="rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-[var(--text-dim)] transition hover:border-white/30 hover:text-white disabled:opacity-40"
    >
      {busy ? "Connecting…" : "+ Connect bank"}
    </button>
  );
}
