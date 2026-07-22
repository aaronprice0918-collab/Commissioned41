// Text conversation intelligence — sentiment scoring, response-time
// tracking, and conversation health metrics. Runs on inbound messages at
// webhook time and powers EILA's coaching and proactive nudges.

import type { LeadMessage } from "@/lib/comms";

export type SentimentLabel = "hot" | "warm" | "neutral" | "cold" | "stop";

// Keyword-based fast sentiment — runs on every inbound text at webhook time.
// Not ML, intentionally: a dealership text thread is short, the customer's
// signal is usually obvious, and a 0ms classification that's 85% accurate
// beats a 2s API call that's 92% accurate when it runs on every webhook.
const HOT_PATTERNS = [
  /\b(yes|yeah|yep|yea|sure|absolutely|definitely|let'?s do it|i'?m in|ready|come in|sounds good|deal|perfect|great|love it|when can i|sign me up)\b/i,
  /\b(interested|want to|looking forward|can'?t wait|excited)\b/i,
  /\b(what time|when are you open|address|where are you|directions)\b/i,
];
const WARM_PATTERNS = [
  /\b(maybe|possibly|thinking|consider|tell me more|what'?s the|how much|price|payment|details)\b/i,
  /\b(not sure yet|need to think|talk to|check with)\b/i,
];
// COLD kept SPECIFIC — the old version matched bare "don't|won't|can't", which
// scored "can't wait!" (hot enthusiasm) as cold. These are explicit rejections.
const COLD_PATTERNS = [
  /\b(no thanks?|no thank you|not interested|not (ready|looking|buying)|already (bought|purchased|got one)|went (somewhere|elsewhere)|elsewhere|not right now|changed my mind|do ?n'?t want|wo ?n'?t be|stop contacting|no longer)\b/i,
  /\b(too expensive|too much|can'?t afford|out of.*(budget|range))\b/i,
];
// A positive keyword negated is a rejection: "not interested", "no longer
// interested", "don't want to come in". Checked FIRST so HOT's bare
// "\binterested\b" can't fire on "not interested" (the original bug: a customer
// saying "not interested" was scored HOT and the rep got nudged to pounce).
const NEGATED_POSITIVE =
  /\b(not|no longer|isn'?t|are ?n'?t|wo ?n'?t|do ?n'?t|ca ?n'?t|never)\b[^.!?]{0,20}\b(interested|ready|want|buy|buying|coming|come in|going to)\b/i;
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);

export function scoreSentiment(body: string): { label: SentimentLabel; confidence: number } {
  const text = String(body || "").trim().toLowerCase();
  if (STOP_WORDS.has(text)) return { label: "stop", confidence: 1.0 };
  // Rejections win over positives: negated-positive and explicit cold BEFORE hot,
  // so "not interested" / "no longer looking" never read as hot.
  if (NEGATED_POSITIVE.test(text)) return { label: "cold", confidence: 0.85 };
  if (COLD_PATTERNS.some((p) => p.test(text))) return { label: "cold", confidence: 0.8 };
  if (HOT_PATTERNS.some((p) => p.test(text))) return { label: "hot", confidence: 0.85 };
  if (WARM_PATTERNS.some((p) => p.test(text))) return { label: "warm", confidence: 0.7 };
  return { label: "neutral", confidence: 0.5 };
}

// Response-time tracking — how fast did the store reply to the customer's
// last inbound text? Computed from the message thread on the lead.
export type ResponseMetrics = {
  avgResponseMinutes: number | null;
  lastInboundAt: string | null;
  lastResponseAt: string | null;
  waitingForReply: boolean; // customer texted, store hasn't replied yet
  waitingMinutes: number | null; // how long they've been waiting
  totalInbound: number;
  totalOutbound: number;
};

export function responseMetrics(messages: LeadMessage[] | undefined, now = new Date()): ResponseMetrics {
  const msgs = messages ?? [];
  const inbound = msgs.filter((m) => m.dir === "in");
  const outbound = msgs.filter((m) => m.dir === "out");

  const responseTimes: number[] = [];
  // For each inbound, find the next outbound after it
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].dir !== "in") continue;
    const inAt = new Date(msgs[i].at).getTime();
    for (let j = i + 1; j < msgs.length; j++) {
      if (msgs[j].dir === "out") {
        const outAt = new Date(msgs[j].at).getTime();
        if (outAt > inAt) {
          responseTimes.push((outAt - inAt) / 60000);
          break;
        }
      }
    }
  }

  const lastInbound = inbound.length ? inbound[inbound.length - 1] : null;
  const lastOutbound = outbound.length ? outbound[outbound.length - 1] : null;
  const waitingForReply = lastInbound !== null && (
    !lastOutbound || new Date(lastOutbound.at).getTime() < new Date(lastInbound.at).getTime()
  );
  const waitingMinutes = waitingForReply && lastInbound
    ? Math.round((now.getTime() - new Date(lastInbound.at).getTime()) / 60000)
    : null;

  return {
    avgResponseMinutes: responseTimes.length
      ? Math.round((responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length) * 10) / 10
      : null,
    lastInboundAt: lastInbound?.at ?? null,
    lastResponseAt: lastOutbound?.at ?? null,
    waitingForReply,
    waitingMinutes,
    totalInbound: inbound.length,
    totalOutbound: outbound.length,
  };
}

// Stale-lead detection — leads with text consent that haven't been contacted
// in too long, or that have an unanswered inbound text.
export type TextNudge = {
  leadId: string;
  customer: string;
  salesperson: string;
  reason: string;
  urgency: "high" | "medium" | "low";
};

export function textNudges(
  leads: any[],
  now = new Date(),
): TextNudge[] {
  const nudges: TextNudge[] = [];
  const HOURS = 60; // minutes

  for (const lead of leads) {
    if (!lead.customerPhone || lead.status === "Won" || lead.status === "Lost") continue;
    const msgs: LeadMessage[] = lead.messages ?? [];
    const metrics = responseMetrics(msgs, now);

    // Unanswered inbound — customer is waiting
    if (metrics.waitingForReply && metrics.waitingMinutes !== null && metrics.waitingMinutes > 15) {
      nudges.push({
        leadId: lead.id,
        customer: lead.customer || "Unknown",
        salesperson: lead.salesperson || "Unassigned",
        reason: `Customer texted ${metrics.waitingMinutes >= 60 ? `${Math.round(metrics.waitingMinutes / 60)}h` : `${metrics.waitingMinutes}m`} ago — no reply yet`,
        urgency: metrics.waitingMinutes > HOURS ? "high" : "medium",
      });
      continue;
    }

    // Hot sentiment on last inbound but no outbound follow-up
    if (msgs.length > 0) {
      const lastIn = [...msgs].reverse().find((m) => m.dir === "in");
      if (lastIn) {
        const sentiment = scoreSentiment(lastIn.body);
        if (sentiment.label === "hot" && metrics.waitingForReply) {
          nudges.push({
            leadId: lead.id,
            customer: lead.customer || "Unknown",
            salesperson: lead.salesperson || "Unassigned",
            reason: `HOT reply ("${lastIn.body.slice(0, 40)}${lastIn.body.length > 40 ? "…" : ""}") — strike while it's warm`,
            urgency: "high",
          });
        }
      }
    }
  }

  // Sort: high urgency first
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return nudges.sort((a, b) => order[a.urgency] - order[b.urgency]);
}

// Per-rep text analytics — aggregate stats for coaching.
export type RepTextStats = {
  name: string;
  totalSent: number;
  totalReceived: number;
  avgResponseMinutes: number | null;
  unansweredCount: number;
};

export function repTextAnalytics(leads: any[], now = new Date()): RepTextStats[] {
  const byRep = new Map<string, { sent: number; received: number; responseTimes: number[]; unanswered: number }>();

  for (const lead of leads) {
    const rep = lead.salesperson || "Unassigned";
    if (!byRep.has(rep)) byRep.set(rep, { sent: 0, received: 0, responseTimes: [], unanswered: 0 });
    const stats = byRep.get(rep)!;
    const metrics = responseMetrics(lead.messages, now);
    stats.sent += metrics.totalOutbound;
    stats.received += metrics.totalInbound;
    if (metrics.avgResponseMinutes !== null) stats.responseTimes.push(metrics.avgResponseMinutes);
    if (metrics.waitingForReply) stats.unanswered += 1;
  }

  return [...byRep.entries()]
    .map(([name, s]) => ({
      name,
      totalSent: s.sent,
      totalReceived: s.received,
      avgResponseMinutes: s.responseTimes.length
        ? Math.round((s.responseTimes.reduce((t, v) => t + v, 0) / s.responseTimes.length) * 10) / 10
        : null,
      unansweredCount: s.unanswered,
    }))
    .sort((a, b) => b.totalSent - a.totalSent);
}
