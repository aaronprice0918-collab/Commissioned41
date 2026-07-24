import { NextResponse } from "next/server";
import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { hasActiveSubscription } from "@/lib/entitlement";
import { followUpQueue, forecast } from "@/lib/engine";
import { vscIdOf } from "@/lib/fni";
import type { AppData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The one place EILA decides what's worth waking someone's phone up for. Runs
// once daily (vercel.json cron) across every subscribed user — at most ONE
// nudge per person per day (last_nudged_date), picking the single most
// important thing rather than sending a pile of notifications. Silence is the
// correct output when nothing needs attention; never nudge just to nudge.
// Priority: overdue > due today > going cold > behind pace this month.
function pickNudge(data: AppData): { title: string; body: string; url: string } | null {
  if (!data.profile) return null;
  // Seeded sample deals must never wake a phone — a new subscriber's demo
  // month includes appointment/finance deals with followUpAt set, which read
  // as real overdue follow-ups here (July 8 audit).
  const deals = data.deals.filter((d) => !d.demo);
  if (!deals.length) return null; // nothing real logged yet — silence, not "pacing 0" spam
  // Bucket follow-ups in the rep's OWN day, not the cron's UTC — otherwise a
  // touch set for tonight can land in a different bucket than the rep's screen
  // shows. Falls back to a US-Eastern default when the rep hasn't recorded a
  // zone yet (closer to a US rep's day than UTC; resolves exactly once captured).
  const tz = data.profile.timeZone || "America/New_York";
  const q = followUpQueue(deals, new Date(), tz);

  if (q.overdue.length > 0) {
    const n = q.overdue.length;
    return { title: "EILA", body: `${n} customer touch${n === 1 ? "" : "es"} overdue — keep the day clean.`, url: "/day" };
  }
  if (q.dueToday.length > 0) {
    const n = q.dueToday.length;
    return { title: "EILA", body: `${n} customer touch${n === 1 ? "" : "es"} due today.`, url: "/day" };
  }
  if (q.goingCold.length > 0) {
    const n = q.goingCold.length;
    return { title: "EILA", body: `${n} ${n === 1 ? "lead is" : "leads are"} going quiet — check your day plan.`, url: "/day" };
  }

  const goal = data.profile.plan.goalUnits ?? 0;
  if (goal > 0) {
    const f = forecast(data.profile.plan, deals, new Date(), data.profile.daysOff ?? [], vscIdOf(data.profile));
    if (f.paceUnits < goal) {
      // Plain, self-explanatory: paceUnits is the projected month-end finish at
      // today's rate. "pacing 27 against a goal of 50" read as a riddle (and when
      // iOS's notification summary stacked two days' nudges it looked like a
      // contradiction — "pacing 27... pacing 41..."). Say what the number IS.
      return { title: "EILA", body: `At today's pace you'll finish the month at ${f.paceUnits}, short of your ${goal}-unit goal. Let's close the gap today.`, url: "/" };
    }
  }
  return null;
}

function todayStr(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

interface SubRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  last_nudged_date: string | null;
}

export async function GET(req: Request) {
  // Vercel Cron calls this with the secret as a bearer token — fail CLOSED if
  // the secret is missing entirely (a misconfigured env, not just a bad
  // request) rather than silently letting an unauthenticated caller through.
  // Caught in the July 5 audit: the old `if (secret) {...}` shape skipped the
  // check entirely when CRON_SECRET was unset, which would have let anyone on
  // the open internet enumerate every user via the service-role client and
  // spam pushes on demand.
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Cron not configured." }, { status: 503 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!admin || !vapidPublic || !vapidPrivate || !vapidSubject) {
    return NextResponse.json({ error: "Nudges aren't configured yet." }, { status: 503 });
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const { data: subs, error: subErr } = await admin.from("lite_push_subscriptions").select("*");
  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });
  if (!subs?.length) return NextResponse.json({ sent: 0, skipped: 0, total: 0 });

  const today = todayStr();
  const { data: userData } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map((userData?.users ?? []).map((u) => [u.id, u.email?.toLowerCase() ?? ""]));

  let sent = 0;
  let skipped = 0;

  for (const row of subs as SubRow[]) {
    if (row.last_nudged_date === today) { skipped++; continue; }

    const email = emailById.get(row.user_id);
    if (!email) { skipped++; continue; }
    const entitled = await hasActiveSubscription(email).catch(() => false);
    if (!entitled) { skipped++; continue; }

    // NOTE: "lite_state" here must match STATE_TABLE in lib/supabase.ts — kept
    // as a literal since that file is a client module and shouldn't be
    // imported into server-only cron code.
    const { data: stateRow } = await admin.from("lite_state").select("data").eq("user_id", row.user_id).maybeSingle();
    const appData = (stateRow as { data?: AppData } | null)?.data;
    if (!appData) { skipped++; continue; }

    const nudge = pickNudge(appData);
    if (!nudge) { skipped++; continue; }

    try {
      // Mark today's nudge as sent BEFORE actually sending it. If the process
      // dies/times out between the two calls, the worst case is a rare
      // under-send (caught next run) instead of a duplicate push landing
      // twice on a retry — under-sending once is far better than spamming
      // someone's phone twice (audit finding, July 5).
      await admin.from("lite_push_subscriptions").update({ last_nudged_date: today }).eq("user_id", row.user_id);
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_key } },
        JSON.stringify(nudge),
      );
      sent++;
    } catch (e) {
      // 404/410 means the subscription is dead (uninstalled, browser data
      // cleared, etc.) — clean it up so future runs stop wasting time on it.
      const status = (e as { statusCode?: number } | null)?.statusCode;
      if (status === 404 || status === 410) {
        await admin.from("lite_push_subscriptions").delete().eq("user_id", row.user_id);
      }
      skipped++;
    }
  }

  return NextResponse.json({ sent, skipped, total: subs.length });
}
