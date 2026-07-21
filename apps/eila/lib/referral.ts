"use client";

// Client half of the referral program. A share link lands as ?ref=CODE — but
// sign-up navigates before checkout ever shows, so (same pattern as team
// codes and invite codes) the code is stashed the moment it's seen and
// survives in localStorage until checkout uses it.
const REFERRAL_KEY = "lite-referral";

export function captureReferralCode() {
  try {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code) localStorage.setItem(REFERRAL_KEY, code.trim());
  } catch {}
}

export function stashedReferralCode(): string | null {
  try {
    return localStorage.getItem(REFERRAL_KEY);
  } catch {
    return null;
  }
}

export function clearReferralCode() {
  try {
    localStorage.removeItem(REFERRAL_KEY);
  } catch {}
}
