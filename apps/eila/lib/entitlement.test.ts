import { describe, it, expect } from "vitest";
import {
  isEntitledStatus,
  isCompEmail,
  isValidTeamCode,
  isValidTrialCode,
  firstTrialCode,
} from "./entitlement";

// The entitlement decision is money-correctness: it controls who can use a paid
// app. Lock the exact mapping so a future refactor can't silently let a lapsed
// or unpaid subscription back in (false-negative on revenue) or lock out a
// paying customer (false-positive on support tickets).
describe("isEntitledStatus", () => {
  it("grants access to active and trialing subscriptions", () => {
    expect(isEntitledStatus("active")).toBe(true);
    expect(isEntitledStatus("trialing")).toBe(true);
  });

  it("grants access to comped accounts (team codes — our status, not Stripe's)", () => {
    expect(isEntitledStatus("comped")).toBe(true);
  });

  it("denies access to dunning, canceled, and incomplete states", () => {
    // past_due = a payment failed and Stripe is retrying. Not entitled.
    expect(isEntitledStatus("past_due")).toBe(false);
    expect(isEntitledStatus("canceled")).toBe(false);
    expect(isEntitledStatus("unpaid")).toBe(false);
    expect(isEntitledStatus("incomplete")).toBe(false);
    expect(isEntitledStatus("incomplete_expired")).toBe(false);
    expect(isEntitledStatus("paused")).toBe(false);
  });

  it("denies access for missing/empty/unknown status (fails closed)", () => {
    expect(isEntitledStatus(null)).toBe(false);
    expect(isEntitledStatus(undefined)).toBe(false);
    expect(isEntitledStatus("")).toBe(false);
    expect(isEntitledStatus("Active")).toBe(false); // case-sensitive; Stripe is lowercase
    expect(isEntitledStatus("garbage")).toBe(false);
  });
});

describe("isCompEmail (owner / comp allowlist)", () => {
  const LIST = "aaronprice@commissioned41.com, team@commissioned41.com";

  it("grants listed emails, case-insensitively and trimming whitespace", () => {
    expect(isCompEmail("aaronprice@commissioned41.com", LIST)).toBe(true);
    expect(isCompEmail("AaronPrice@Commissioned41.com", LIST)).toBe(true);
    expect(isCompEmail("team@commissioned41.com", LIST)).toBe(true);
  });

  it("denies non-listed, empty, and unconfigured", () => {
    expect(isCompEmail("someone@gmail.com", LIST)).toBe(false);
    expect(isCompEmail("", LIST)).toBe(false);
    expect(isCompEmail("aaronprice@commissioned41.com", "")).toBe(false);
    expect(isCompEmail("aaronprice@commissioned41.com", undefined)).toBe(false);
  });
});

describe("isValidTeamCode (team comp codes)", () => {
  const CODES = "kennesaw-mazda, riverside-toyota";

  it("accepts listed codes, case-insensitively and trimming whitespace", () => {
    expect(isValidTeamCode("kennesaw-mazda", CODES)).toBe(true);
    expect(isValidTeamCode("Kennesaw-Mazda", CODES)).toBe(true);
    expect(isValidTeamCode("  riverside-toyota  ", CODES)).toBe(true);
  });

  it("rejects non-listed and empty codes (fails closed)", () => {
    expect(isValidTeamCode("some-other-store", CODES)).toBe(false);
    expect(isValidTeamCode("", CODES)).toBe(false);
  });

  it("falls back to the built-in default when no env is set, and env REPLACES it", () => {
    // No TEAM_CODES env in tests -> the built-in default list applies. This is
    // what lets the shareable team link work with zero dashboard config.
    expect(isValidTeamCode("kennesaw-mazda")).toBe(true);
    expect(isValidTeamCode("not-a-team")).toBe(false);
    // Setting the env replaces the default entirely — the revoke lever.
    expect(isValidTeamCode("kennesaw-mazda", "other-store")).toBe(false);
  });
});

describe("trial codes (isValidTrialCode / firstTrialCode)", () => {
  it("falls back to the built-in default when no env is set, and env REPLACES it", () => {
    // No TRIAL_CODES env in tests -> built-in default. /free-trial links to the
    // first code, and checkout must accept that same code round-trip.
    const def = firstTrialCode();
    expect(def).toBeTruthy();
    expect(isValidTrialCode(def as string)).toBe(true);
    expect(isValidTrialCode("garbage-code")).toBe(false);
    // Env override replaces the default entirely.
    expect(firstTrialCode("summer24, vip")).toBe("summer24");
    expect(isValidTrialCode("summer24", "summer24, vip")).toBe(true);
    expect(isValidTrialCode(def as string, "summer24")).toBe(false);
  });

  it("matches case-insensitively and trims", () => {
    expect(isValidTrialCode("  Summer24 ", "summer24")).toBe(true);
    expect(isValidTrialCode("", "summer24")).toBe(false);
  });
});

import { isOwner } from "./owner";
describe("isOwner — locks the Pulse to the owner only", () => {
  const LIST = "aaronprice@commissioned41.com";
  it("grants the owner", () => expect(isOwner("aaronprice@commissioned41.com", LIST)).toBe(true));
  it("is case-insensitive", () => expect(isOwner("AaronPrice@Commissioned41.com", LIST)).toBe(true));
  it("denies a paying customer", () => expect(isOwner("kellcey24@gmail.com", LIST)).toBe(false));
  it("denies a comped team member", () => expect(isOwner("danielmaharaj34@gmail.com", LIST)).toBe(false));
  it("denies empty", () => expect(isOwner("", LIST)).toBe(false));
});
