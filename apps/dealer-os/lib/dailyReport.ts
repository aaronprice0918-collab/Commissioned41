import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { sendEmail } from "@/lib/email";
import { normalizeAccessRole } from "@/lib/access";
import {
  metricsFor, currentMonthPace, salesLeaderboard, financeLeaderboard,
  salespersonNamesFromDeals, financeManagerNamesFromDeals, currency, number,
  unitsLabel, dailyNeed, paceValue, type Deal,
} from "@/lib/data";

// EILA's nightly End-of-Day Brief for the managers — highlights, where we stand,
// what to do better, and a tight action plan. One Opus call per store per night
// (pennies). Generated on demand (a manager taps "Generate") or by the nightly
// cron, stored per org, and surfaced on the GM command screen.

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

type Sb = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

async function loadKey(sb: Sb, orgId: string, key: string): Promise<any> {
  const { data } = await sb.from("app_store").select("value").eq("org_id", orgId).eq("key", key).maybeSingle();
  return data?.value ?? null;
}

const SYSTEM = `You are EILA, the dealership's AI sales manager — sharp, honest, and in command. You write the nightly End-of-Day Brief for the store's managers. Voice: a confident, respected leader who has watched the whole floor today. Direct and motivating, never fluffy, never a downer — you tell the truth and you point the way forward.`;

const PROMPT = `Write tonight's END-OF-DAY BRIEF for the managers, in clean markdown, CLEAR and CONCISE (a busy GM reads it in under two minutes). Use exactly these sections, with short punchy bullets — no padding:

## Where We Stand
2–4 bullets: units & gross vs goal, pace for the month, and the one number that matters most right now.

## Highlights
The real wins today — who showed up, a standout deal, momentum worth naming. Be specific (names, numbers).

## Key Takeaways
The 2–4 things a manager must know from today — what's working, what shifted.

## What We Can Do Better
Honest and specific — leaks, missed gross, un-worked leads, a rep slipping, a process gap. Name it plainly (you're respected enough to be straight), but frame it as fixable.

## The Plan — Tomorrow
A clear, prioritized action plan: the 3–5 concrete moves to make tomorrow to close the gap to goal — who does what. End with one line of vision: where this gets us by month-end if we execute.

Use the live data below. Use real names and real numbers; never invent figures. If something's missing, work with what's there. Keep the whole brief tight.

=== TODAY'S DATA ===
`;

function buildSummary(deals: Deal[], leads: any[], teamV: any, goals: any, settings: any, storeMem: any, mistakeMem: any): string {
  const L: string[] = [];
  const storeName = settings?.storeName || "the store";
  const targets = settings?.targets || {};
  const metrics = metricsFor(deals);
  const pace = currentMonthPace(deals);
  // ONE definition store-wide: total = front + back + doc income (metrics.gross)
  const totalGross = metrics.gross;
  const deliveredGoal = goals?.teamDeliveredUnits || targets.deliveredUnits || 0;
  const projected = paceValue(metrics.delivered, pace);
  const need = deliveredGoal ? dailyNeed(deliveredGoal, metrics.delivered, pace.remainingDays) : 0;

  L.push(`Store: ${storeName} · ${pace.monthName}, day ${Math.max(pace.elapsedDays, 1)} of ${pace.daysInMonth} (${pace.remainingDays} selling days left).`);
  L.push(`Units MTD: ${unitsLabel(metrics.delivered)} of ${deliveredGoal || "—"} goal (pacing to ~${number(projected, 0)}). Need ~${number(need, 1)}/day to land it.`);
  L.push(`Gross MTD: front ${currency(metrics.front)} | back ${currency(metrics.back)} | total ${currency(totalGross)} | PVR ${currency(metrics.delivered ? Math.round(totalGross / metrics.delivered) : 0)}.`);

  const spNames = Array.from(new Set([...(Array.isArray(teamV?.salespeople) ? teamV.salespeople : []), ...salespersonNamesFromDeals(deals)]));
  const sBoard = salesLeaderboard(deals, spNames).filter((r: any) => r.units > 0 || (goals?.salespersonUnits?.[r.name] ?? 0) > 0);
  L.push("");
  L.push("Salesperson board (units · total gross · PVR):");
  for (const r of sBoard) {
    const g = goals?.salespersonUnits?.[r.name] ?? 0;
    L.push(`  ${r.name}: ${unitsLabel(r.units)}u${g ? ` / ${g} goal` : ""} · ${currency(r.totalGross)} · ${currency(r.pvr)}`);
  }

  const fiNames = Array.from(new Set([...(Array.isArray(teamV?.financeManagers) ? teamV.financeManagers : []), ...financeManagerNamesFromDeals(deals)]));
  const fBoard = financeLeaderboard(deals, fiNames).filter((r: any) => r.copies > 0);
  if (fBoard.length) {
    L.push("");
    L.push("F&I board (copies · back gross · PVR):");
    for (const r of fBoard) L.push(`  ${r.name}: ${r.copies} copies · ${currency(r.backGross)} · ${currency(r.pvr)}`);
  }

  // Pipeline health — what's slipping (un-worked leads)
  const active = (Array.isArray(leads) ? leads : []).filter((l: any) => !["Won", "Lost", "Dead"].includes(l.status));
  const noNext = active.filter((l: any) => !l.nextAction);
  const today = new Date().toISOString().slice(0, 10);
  const apptToday = active.filter((l: any) => String(l.appointment || "").slice(0, 10) === today).length;
  L.push("");
  L.push(`Pipeline: ${active.length} active leads, ${apptToday} appointments today, ⚠ ${noNext.length} with NO next action set (slipping — needs follow-up).`);
  if (noNext.length) L.push(`  Slipping: ${noNext.slice(0, 12).map((l: any) => `${l.customer || "?"} (${l.salesperson || "unassigned"})`).join(", ")}`);

  // EILA's learned playbook + mistakes (grounds "what we can do better")
  const patterns: any[] = Array.isArray(storeMem?.patterns) ? storeMem.patterns : [];
  if (patterns.length) {
    L.push("");
    L.push("Patterns you've learned about this floor:");
    for (const p of patterns.slice(-8)) L.push(`  - ${typeof p === "string" ? p : p.text}`);
  }
  const mistakes: any[] = Array.isArray(mistakeMem?.mistakes) ? mistakeMem.mistakes : [];
  if (mistakes.length) {
    L.push("");
    L.push("Mistakes to keep catching:");
    for (const m of mistakes.slice(-6)) L.push(`  - ${m.what}${m.sign ? ` (watch: ${m.sign})` : ""}`);
  }

  return L.join("\n");
}

async function callAnthropic(apiKey: string, summary: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1600,
        system: SYSTEM,
        messages: [{ role: "user", content: `${PROMPT}${summary}` }],
      }),
    });
    if (res.ok) {
      const out = await res.json();
      const block = Array.isArray(out?.content) ? out.content.find((c: any) => c.type === "text") : null;
      return block?.text || "";
    }
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 700 * (attempt + 1))); continue; }
    break;
  }
  return "";
}

// Turn the brief's markdown into a clean email body.
function reportToHtml(report: string, dateKey: string, storeName: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const strong = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "<strong style=\"color:#fff\">$1</strong>");
  const body = report.split(/\r?\n/).map((ln) => {
    const t = ln.trim();
    if (!t) return "";
    if (t.startsWith("## ")) return `<h3 style="color:#5a8bff;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;margin:18px 0 6px">${esc(t.slice(3))}</h3>`;
    if (t.startsWith("# ")) return `<h2 style="color:#fff;margin:10px 0 6px">${esc(t.slice(2))}</h2>`;
    if (/^[-*]\s/.test(t)) return `<div style="margin:4px 0;padding-left:14px;text-indent:-10px">• ${strong(esc(t.replace(/^[-*]\s/, "")))}</div>`;
    return `<p style="margin:6px 0">${strong(esc(t))}</p>`;
  }).join("");
  return `<div style="background:#070b16;color:#cdd6e4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:26px;max-width:640px;line-height:1.55;font-size:14px">
    <div style="font-weight:800;font-size:18px;color:#fff;letter-spacing:.5px">MISSION<span style="color:#5a8bff">OS</span></div>
    <div style="color:#7c8aa0;font-size:12px;margin:2px 0 18px">${esc(storeName)} · End-of-Day Brief · ${esc(dateKey)}</div>
    ${body}
    <div style="color:#52607a;font-size:11px;margin-top:24px;border-top:1px solid #1a2230;padding-top:10px">Written by EILA · Dealer Mission OS</div>
  </div>`;
}

// Generate, store, and (when deliver=true, i.e. the nightly run) deliver tonight's
// brief to the managers — their Dealer Mission OS inbox AND their email. A manual
// "Refresh" on the GM screen regenerates without spamming inboxes/email.
export async function generateDailyReport(orgId: string, nowISO: string, deliver = false): Promise<{ ok: boolean; report?: string; error?: string }> {
  const sb = getSupabaseServerClient();
  if (!sb) return { ok: false, error: "Store not connected." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not set." };

  const [deals, leads, teamV, goals, settings, storeMem, mistakeMem] = await Promise.all([
    loadKey(sb, orgId, "deals"), loadKey(sb, orgId, "crmLeads"), loadKey(sb, orgId, "team"),
    loadKey(sb, orgId, "goals"), loadKey(sb, orgId, "storeSettings"),
    loadKey(sb, orgId, "storeMemory"), loadKey(sb, orgId, "mistakeMemory"),
  ]);
  const dealsArr: Deal[] = Array.isArray(deals) ? deals : [];
  const summary = buildSummary(dealsArr, Array.isArray(leads) ? leads : [], teamV, goals, settings, storeMem, mistakeMem);

  const report = await callAnthropic(apiKey, summary);
  if (!report) return { ok: false, error: "Couldn't generate the brief — try again." };

  const dateKey = nowISO.slice(0, 10);
  const existing = await loadKey(sb, orgId, "dailyReports");
  const store: any = existing && typeof existing === "object" ? existing : {};
  store.latest = { date: dateKey, generatedAt: nowISO, report };
  store.history = Array.isArray(store.history) ? store.history.filter((h: any) => h.date !== dateKey) : [];
  store.history.unshift({ date: dateKey, generatedAt: nowISO, report });
  store.history = store.history.slice(0, 30);
  await sb.from("app_store").upsert({ org_id: orgId, key: "dailyReports", value: store, updated_at: nowISO }, { onConflict: "org_id,key" });

  // Deliver to the managers — ONLY on the nightly run (deliver=true), so a manual
  // "Refresh" on the GM screen never spams inboxes or email. Both best-effort.
  if (deliver) {
    const storeName = settings?.storeName || "the store";

    // 1) Each sales manager's Dealer Mission OS private inbox
    try {
      const managers = Array.isArray(teamV?.managers) ? teamV.managers : [];
      if (managers.length) {
        const msgs = await loadKey(sb, orgId, "messages");
        const messages: any[] = Array.isArray(msgs) ? msgs : [];
        managers.forEach((name: string, i: number) => {
          messages.unshift({
            id: `ila-eod-${dateKey}-${i}`,
            from: "EILA",
            to: `Manager:${name}`,
            body: `📊 End-of-Day Brief — ${dateKey}\n\n${report}`,
            createdAt: nowISO,
            ts: Date.parse(nowISO) || undefined,
          });
        });
        await sb.from("app_store").upsert({ org_id: orgId, key: "messages", value: messages, updated_at: nowISO }, { onConflict: "org_id,key" });
      }
    } catch {
      // inbox delivery is a bonus; the stored brief on the GM screen is the source of truth
    }

    // 2) Email it to every manager / leader at their Dealer Mission OS login email
    try {
      const { data: profs } = await sb.from("user_profiles").select("email, role").eq("org_id", orgId);
      const emails = Array.from(new Set((profs || [])
        .filter((p: any) => ["Manager", "Admin", "F&I"].includes(normalizeAccessRole(p.role)))
        .map((p: any) => p.email)
        .filter(Boolean))) as string[];
      if (emails.length) {
        await sendEmail({
          to: emails,
          subject: `End-of-Day Brief — ${storeName} — ${dateKey}`,
          html: reportToHtml(report, dateKey, storeName),
          text: report,
        });
      }
    } catch {
      // email is best-effort; it lights up the moment Resend is configured
    }
  }

  return { ok: true, report };
}

// Every org that has any deals or leads — the set the nightly cron generates for.
export async function activeOrgIds(): Promise<string[]> {
  const sb = getSupabaseServerClient();
  if (!sb) return [];
  const { data } = await sb.from("app_store").select("org_id").in("key", ["deals", "crmLeads"]);
  return Array.from(new Set((data || []).map((r: any) => r.org_id).filter(Boolean)));
}
