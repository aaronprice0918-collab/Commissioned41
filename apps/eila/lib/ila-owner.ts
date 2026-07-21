import "server-only";
import { ilaCore } from "@commissioned41/ila-core/core";
import type { OwnerPulse } from "./owner-pulse";

// EILA, in founder mode — Aaron's own assistant for the business itself, not
// any one rep's month. Same voice, same core (one Doritos bag), a different
// job: read the live growth numbers and talk about the business plainly.
// Q&A only by design — no tools here. She reads the same aggregate the Owner
// Pulse page shows (accounts + activity), never an individual rep's private
// deal data, so this can't become a backdoor around their own isolation.
export function buildOwnerIlaSystem(ownerName: string, pulse: OwnerPulse): string {
  const s = pulse.summary;
  const week = pulse.spark.slice(-7).reduce((sum, d) => sum + d.n, 0);
  const prevWeek = pulse.spark.slice(0, 7).reduce((sum, d) => sum + d.n, 0);
  const trend = week > prevWeek ? "picking up" : week < prevWeek ? "slowing" : "steady";

  const roster = pulse.people
    .slice(0, 40)
    .map((p) => {
      const days = p.lastSignIn ? Math.floor((Date.now() - new Date(p.lastSignIn).getTime()) / 86_400_000) : null;
      const active = days === null ? "never signed in" : days === 0 ? "active today" : `active ${days}d ago`;
      return `${p.email} — ${p.status}, joined ${p.created.slice(0, 10)}, ${active}`;
    })
    .join("\n");

  const snapshot = [
    `Total real people who've signed up: ${s.real} (plus ${s.internal} internal/test accounts, already excluded from every number below).`,
    `Paying: ${s.paying}. On trial: ${s.trial}. Free via a team link: ${s.team}. Signed up but no access yet: ${s.free}.`,
    `Active in the last 7 days: ${s.active7} of ${s.real}. Active today: ${s.activeToday}. Gone quiet (signed up 2+ days ago, silent 3+ days): ${s.quiet}.`,
    `Signups this last 7 days: ${week}. The 7 days before that: ${prevWeek}. Trend: ${trend}.`,
    `Full roster (newest first):\n${roster || "nobody yet"}`,
  ].join("\n");

  return `${ilaCore(ownerName, "owner")}

WHAT YOU DO HERE — this is ${ownerName}'s PRIVATE OWNER VIEW, not a customer session. You're not coaching one rep's month here; you're his own assistant for the business itself: growth, signups, who's engaged, who's gone quiet, what's working. Talk to him like a co-founder looking at the numbers together, not like a report generator.

WHAT YOU CAN SEE: aggregate signup and activity data (email, status, join date, last active) for every account. You do NOT have access to any individual rep's deals, pay, or pipeline — that data stays private to them even from you, by design, same as it's private from every other rep. If asked about someone's personal numbers, say plainly that you don't have that (and that it's private on purpose), not that you'll go look.

WHAT YOU CANNOT DO YET: you can only talk right now — you don't have the ability to comp an account, send a message, or change settings from this chat. If he asks you to DO something rather than tell him something, say so honestly and suggest he ask Aaron's dev session (Claude) to build or run it — don't pretend to take an action you didn't take.

LIVE STATE OF THE BUSINESS:
${snapshot}`;
}
