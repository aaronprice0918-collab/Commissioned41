// Fixed Ops Weekly Digest — the GM's Monday-morning text. One compact read:
// did we keep our promises, what money is sitting on shelves and in declined
// work, and the single move to make first. ONE BRAIN, three outlets: the
// weekly cron (SMS when Twilio + a digest number are configured), EILA's
// fixed_ops_digest tool, and anything else that ever needs the same numbers.

import { currency } from "./data";
import { promiseStats, recaptureList, laneStats, type ServiceVisit } from "./service";
import { SOP_AGING_DAYS, counterStats, stockSuggestions, normalizePartsData, type PartsCounterData } from "./parts";

const DAY_MS = 86_400_000;

export type FixedOpsDigest = {
  storeName: string;
  service: {
    inLaneNow: number;
    lateNow: number;
    promised7d: number;
    kept7d: number;
    hitRate7d: number | null; // null when nothing was promised
    winBackOpen: number;
    winBackInWindow: number; // sitting in a 30/60/90 cadence window
  };
  parts: {
    sopsWaiting: number;
    sopsWaitingValue: number;
    sopsAging: number;
    lostSales7d: number;
    lostValue7d: number;
    topSuggestion: string | null;
  };
  topMove: string;
  text: string; // the SMS — compact, phone-first
};

export function buildFixedOpsDigest(
  visits: ServiceVisit[],
  partsRaw: unknown,
  storeName: string,
  now = new Date(),
): FixedOpsDigest {
  const parts = normalizePartsData(partsRaw);
  const lane = laneStats(visits, now);
  const weekPromises = promiseStats(visits, now, 7);
  const promised7d = weekPromises.reduce((s, a) => s + a.promised, 0);
  const kept7d = weekPromises.reduce((s, a) => s + a.kept, 0);
  const missions = recaptureList(visits, now);
  const pStats = counterStats(parts, now);
  const weekCutoff = now.getTime() - 7 * DAY_MS;
  const lost7 = parts.lostSales.filter((l) => new Date(l.at).getTime() >= weekCutoff);
  const suggestions = stockSuggestions(parts.lostSales, now);

  const service = {
    inLaneNow: lane.inLaneNow,
    lateNow: lane.lateNow,
    promised7d,
    kept7d,
    hitRate7d: promised7d ? Math.round((kept7d / promised7d) * 100) : null,
    winBackOpen: missions.length,
    winBackInWindow: missions.filter((m) => m.cadence != null).length,
  };
  const partsOut = {
    sopsWaiting: pStats.sopsWaiting,
    sopsWaitingValue: pStats.sopsWaitingValue,
    sopsAging: pStats.sopsAging,
    lostSales7d: lost7.length,
    lostValue7d: lost7.reduce((s, l) => s + (l.value || 0), 0),
    topSuggestion: suggestions[0] ? `${suggestions[0].label} (asked ${suggestions[0].demands}x in 90d)` : null,
  };

  // The one move — worst leak first.
  const topMove = service.lateNow
    ? `${service.lateNow} vehicle${service.lateNow === 1 ? " is" : "s are"} LATE on a promise right now — those calls come first.`
    : partsOut.sopsAging
      ? `${partsOut.sopsAging} special order${partsOut.sopsAging === 1 ? "" : "s"} aging ${SOP_AGING_DAYS}d+ on the shelf — call before they become returns.`
      : service.winBackInWindow
        ? `${service.winBackInWindow} declined-work customer${service.winBackInWindow === 1 ? " is" : "s are"} in a follow-up window — send the win-back texts.`
        : partsOut.topSuggestion
          ? `Customers keep asking for ${partsOut.topSuggestion} — stock it.`
          : "Clean board. Keep the promises specific and the updates ahead of the customer.";

  const lines = [
    `${storeName} — Fixed Ops weekly`,
    `SERVICE: ${promised7d ? `${kept7d}/${promised7d} promises kept (${service.hitRate7d}%)` : "no promised jobs closed this week"} · ${lane.inLaneNow} in the lane${lane.lateNow ? ` · ${lane.lateNow} LATE NOW` : ""} · win-back ${missions.length} open${service.winBackInWindow ? ` (${service.winBackInWindow} due)` : ""}`,
    `PARTS: ${pStats.sopsWaiting} SOPs on the shelf (${currency(pStats.sopsWaitingValue)})${partsOut.sopsAging ? ` · ${partsOut.sopsAging} aging ${SOP_AGING_DAYS}d+` : ""} · lost sales ${currency(partsOut.lostValue7d)} this week${partsOut.topSuggestion ? ` · stock-it: ${partsOut.topSuggestion}` : ""}`,
    `TOP MOVE: ${topMove}`,
  ];

  return { storeName, service, parts: partsOut, topMove, text: lines.join("\n") };
}
