"use client";

import { getSupabase } from "@/lib/supabase";

// Client half of team comp access. A /team/<code> link lands on the app as
// ?team=CODE — but sign-up navigates before the paywall ever shows, so (like
// invite codes in SubscribeCard) the code is stashed the moment it's seen and
// survives in localStorage until the paywall redeems it against /api/team.
const TEAM_KEY = "lite-team";

export function captureTeamCode() {
  try {
    const code = new URLSearchParams(window.location.search).get("team");
    if (code) localStorage.setItem(TEAM_KEY, code.trim());
  } catch {}
}

export function stashedTeamCode(): string | null {
  try {
    return localStorage.getItem(TEAM_KEY);
  } catch {
    return null;
  }
}

// Did this visitor arrive on a team link? Captures first so it works even when
// asked before the page-level capture effect has run (child effects fire before
// the parent's), then reads the stash.
export function hasTeamInvite(): boolean {
  captureTeamCode();
  return !!stashedTeamCode();
}

function clearTeamCode() {
  try {
    localStorage.removeItem(TEAM_KEY);
  } catch {}
}

// Redeem the stashed code for the signed-in account. Returns true when the
// account is comped (or already entitled) — the caller then reloads so the
// entitlement check picks it up. On a definitive "bad code" the stash is
// cleared so the person just sees the normal subscribe flow next time;
// transient failures keep the code for another attempt.
export async function redeemTeamCode(): Promise<boolean> {
  const code = stashedTeamCode();
  if (!code) return false;
  try {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
    if (!token) return false;
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      clearTeamCode();
      return true;
    }
    if (res.status === 400) clearTeamCode();
    return false;
  } catch {
    return false;
  }
}
