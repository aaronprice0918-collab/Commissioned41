"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Calculator, CalendarClock, ClipboardList, Eye, FilePenLine, FileText, Link2, PhoneCall, Printer, Radar, ScanLine, Send, ShieldCheck, UserCog, X } from "lucide-react";
import { LicenseScanner, InsuranceScanner } from "@/components/LicenseScanner";
import { authHeaders } from "@/lib/storeClient";
import { type CrmLead as Lead, type LeadStatus, type DealStep, useCrmLeads } from "@/components/CrmProvider";
import { CrmAiPanel } from "@/components/CrmAiPanel";
import { CustomerJourney } from "@/components/CustomerJourney";
import { NextActionBar } from "@/components/NextActionBar";
import { usePrivateChat } from "@/components/ChatProvider";
import { scoreLead } from "@/lib/leadScore";
import { DealProgress } from "@/components/DealProgress";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { MetricCard } from "@/components/MetricCard";
import { askIla } from "@/lib/askIla";
import { SectionHeader } from "@/components/SectionHeader";
import { StatusPill } from "@/components/StatusPill";
import { useTeamLists } from "@/components/TeamProvider";
import { currency } from "@/lib/data";
import { calculateDesk, georgiaFees, georgiaFormsPacketUrl, numberFormat, personLabel, tradeSummary } from "@/lib/desk";
import { decodeVin, isValidVin } from "@/lib/vin";
import { firstContactPatch, speedClock, speedStats } from "@/lib/speedToLead";
import { SpeedToLeadChip } from "@/components/SpeedToLeadChip";
import { canContact, recordConsentPatch, type ConsentEvent } from "@/lib/consent";
import { ConsentChips } from "@/components/ConsentChips";
import { useAuth } from "@/components/AuthProvider";
import { TextThread } from "@/components/TextThread";
import { appendMessagePatch } from "@/lib/comms";

function openWorksheetPrint(leadId: string) {
  window.open(`/print/worksheet?lead=${leadId}`, "_blank", "width=920,height=1200");
}

const statuses: LeadStatus[] = ["New Lead", "Working", "Appointment Set", "Shown", "Desking", "In Finance", "Won", "Lost"];
const creditStatuses: Lead["creditStatus"][] = ["Not Started", "Sent", "Received", "Submitted", "Approved", "Declined"];
const suffixOptions = ["", "Sr.", "Jr.", "I", "II", "III", "IV", "V"];

export default function CrmDeskPage() {
  const { salespeople, managers, financeManagers } = useTeamLists();
  // EILA is available to every rep at a store with the assistant on (admins
  // toggle it in Store Settings); the API enforces the same flag server-side.
  const aiAssistantOn = useStoreSettings().settings.aiAssistantEnabled !== false;
  const { leads, addLead: saveLead, updateLead, deleteLead, conflicted, clearConflict } = useCrmLeads();
  const { profile } = useAuth();
  const { sendMessage } = usePrivateChat();
  const [toRequested, setToRequested] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(defaultDraft(salespeople[0] || "", financeManagers[0] || ""));
  const [scanOpen, setScanOpen] = useState(false);
  const [insScanOpen, setInsScanOpen] = useState(false);
  // Photos captured this intake but not yet uploaded — they go to private
  // storage on save, when the lead has a real id to file them under.
  const [pendingDocs, setPendingDocs] = useState<{ license?: string; insurance?: string }>({});
  const [vinStatus, setVinStatus] = useState<"idle" | "decoding" | "ok" | "fail">("idle");
  const [custTab, setCustTab] = useState<"1" | "2">("1");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [intakeTab, setIntakeTab] = useState<"customer" | "vehicle" | "team" | "credit" | "trade" | "insurance" | "journey">("customer");
  const [drill, setDrill] = useState<"today" | "active" | "showroom" | "appointments" | "desking" | "sold" | "left" | "deliveries" | "speed" | null>(null);
  const [lostFor, setLostFor] = useState("");
  const [textingId, setTextingId] = useState("");
  const [shareState, setShareState] = useState<Record<string, "idle" | "working" | "copied" | "error">>({});
  const formRef = useRef<HTMLElement>(null);

  function copyAddressToCoBuyer() {
    setDraft((current) => ({
      ...current,
      coBuyerAddress: current.customerAddress,
      coBuyerCity: current.customerCity,
      coBuyerState: current.customerState,
      coBuyerZip: current.customerZip,
      coBuyerCounty: current.county,
    }));
  }

  const todayKey = dayKey(new Date());
  const isToday = (lead: Lead) => leadDayKey(lead) === todayKey;
  // Did this lead's status become X TODAY? statusHistory carries the real
  // event time; legacy leads without history fall back to "created today".
  const becameToday = (lead: Lead, status: LeadStatus) => {
    const hit = (lead.statusHistory || []).filter((h) => h.status === status).pop();
    if (hit) return dayKey(new Date(hit.at)) === todayKey;
    return lead.status === status && isToday(lead);
  };

  // Active = the whole open pipeline (today AND prior days still being worked).
  const active = leads.filter((lead) => !["Won", "Lost"].includes(lead.status));
  // Today's ups — every lead that came in today, whatever happened to it since
  // (sold, lost, working). The full pipeline lives in `active`, one click deeper.
  const todayLeads = leads.filter(isToday);
  // PHYSICAL PRESENCE (Aaron's rule): the floor = customers manually marked
  // "Customer in Showroom" who haven't sold or left. Presence is a BUTTON, not a
  // status — New Lead / Working / etc. do NOT put someone on the floor.
  const showroomFloor = leads.filter((lead) => lead.inShowroom && !["Won", "Lost"].includes(lead.status));
  const showroom = showroomFloor; // "In showroom now" == the floor
  // Appointments = the same definition as the Appointment Board: an
  // appointment on the books for a lead still in play (the old status-only
  // count disagreed with the Board whenever a Working lead had one set).
  const appointmentsList = leads.filter((lead) => !["Won", "Lost"].includes(lead.status) && (lead.appointment || lead.status === "Appointment Set"));
  // "At Desk NOW" is a state, not a day — a customer who came in yesterday
  // and is at the desk right now counts.
  const deskingList = leads.filter((lead) => lead.status === "Desking");
  const appointments = appointmentsList.length;
  const desking = deskingList.length;

  // Deliveries (cars sold TODAY — by the day they were WON, not the day the
  // lead was created; a Tuesday lead delivered Friday is Friday's delivery).
  // Tapping it breaks into "Came in" vs "Never came in" (remote).
  const deliveries = leads.filter((lead) => lead.status === "Won" && becameToday(lead, "Won"));
  const cameInDeliveries = deliveries.filter((lead) => lead.inShowroom);
  const remoteDeliveries = deliveries.filter((lead) => !lead.inShowroom);

  // Showroom Board daily scoreboard — today's EVENTS.
  const sold = deliveries;
  const left = leads.filter((lead) => lead.status === "Lost" && becameToday(lead, "Lost"));

  // EILA "work the floor next" — the single highest-priority customer to act on
  // right now, so the screen answers "what do I do next?" before anything else.
  const newUps = leads.filter((lead) => lead.status === "New Lead");
  // The Five-Minute Response grade (lib/speedToLead.ts): live clocks + the
  // 30-day store grade. Fresh ups still on the clock sort above breached ones
  // in the drill so the savable ones get worked first.
  const speed = speedStats(leads);
  const floorNeedsTO = showroomFloor.filter((lead) => !lead.deskManager);
  const priority =
    floorNeedsTO[0]
      ? { lead: floorNeedsTO[0], label: `Get a manager to ${floorNeedsTO[0].customer || "the floor"}`, sub: "On the floor with no desk manager — request a TO now", tone: "red" as const }
      : showroomFloor[0]
        ? { lead: showroomFloor[0], label: `Work ${showroomFloor[0].customer || "the floor"}'s deal`, sub: "On the floor right now — keep them moving to numbers", tone: "amber" as const }
        : newUps[0]
          ? { lead: newUps[0], label: `Call ${newUps[0].customer || "your fresh up"}`, sub: "Fresh up — make first contact in under 5 minutes", tone: "red" as const }
          : appointmentsList[0]
            ? { lead: appointmentsList[0], label: `Confirm ${appointmentsList[0].customer || "the appointment"}`, sub: "Appointment set — confirm it so it shows", tone: "amber" as const }
            : null;
  const floorRead = priority
    ? `${showroomFloor.length} on the floor · ${newUps.length} fresh ${newUps.length === 1 ? "up" : "ups"} · ${appointments} appointment${appointments === 1 ? "" : "s"}. Act here first.`
    : `Floor's quiet — ${active.length} active in the pipeline. Prospect and set the next appointment.`;
  const floorAction = priority
    ? { label: priority.label, sub: priority.sub, href: `/desking?lead=${priority.lead.id}` }
    : { label: "Work your pipeline", sub: "Set the next appointment", href: "/deal-center" };
  const floorTone: "red" | "amber" | "green" = priority ? priority.tone : "green";

  // One-tap Manager TO — alerts every sales manager's inbox. No lost deal without
  // a manager getting a shot (VISION #18).
  function requestTO(lead: Lead) {
    const mgrs = managers.length ? managers : ["Sales Manager"];
    mgrs.forEach((m) =>
      sendMessage({
        from: `Sales:${lead.salesperson || "Floor"}`,
        to: `Manager:${m}`,
        body: `TO requested — ${lead.customer || "a customer"} on ${lead.vehicle || "a vehicle"}. Come close.`,
      })
    );
    setToRequested((current) => ({ ...current, [lead.id]: true }));
  }

  const drillViews = {
    today: { title: "Today's Ups", subtitle: `Everyone who came in today · ${active.length} active in the full pipeline`, list: todayLeads },
    active: { title: "Active Leads", subtitle: "The full open pipeline — today and prior days", list: active },
    showroom: { title: "In Showroom", subtitle: "Customers currently in process", list: showroom },
    appointments: { title: "Appointments", subtitle: "Set and waiting to show", list: appointmentsList },
    desking: { title: "At Desk", subtitle: "Needs manager action", list: deskingList },
    sold: { title: "Sold", subtitle: "Marked Won", list: sold },
    left: { title: "Left Showroom", subtitle: "Lost today", list: left },
    deliveries: { title: "Deliveries", subtitle: `${cameInDeliveries.length} came in · ${remoteDeliveries.length} never came in`, list: deliveries },
    speed: {
      title: "5-Minute Response",
      subtitle: `Fresh ups, savable first · 30-day grade: ${speed.under5Pct}% under 5:00 (${speed.measured} graded) · avg ${speed.avgMinutes ?? "—"} min`,
      // On-clock first (still savable), then breached (call NOW), contacted last.
      list: [...newUps].sort((a, b) => {
        const rank = (l: Lead) => {
          const c = speedClock(l);
          return c.state === "on_clock" ? 0 : c.state === "breached" ? 1 : 2;
        };
        return rank(a) - rank(b);
      }),
    },
  } as const;
  const drillView = drill ? drillViews[drill] : null;
  const preview = useMemo(() => buildLead(draft, salespeople, financeManagers), [draft, financeManagers, salespeople]);
  // The lead currently being edited — used to surface documents already on file.
  const editingLead = editingId ? leads.find((lead) => lead.id === editingId) : undefined;

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // Decode the VIN via NHTSA the moment a full 17-char VIN is entered, and
  // auto-fill the vehicle fields. Existing entries are only overwritten when the
  // decoder returns a value, so a manual edit is never blanked out.
  async function handleVinChange(raw: string) {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17);
    update("vin", v);
    if (v.length !== 17 || !isValidVin(v)) {
      setVinStatus("idle");
      return;
    }
    setVinStatus("decoding");
    const decoded = await decodeVin(v);
    if (!decoded) {
      setVinStatus("fail");
      return;
    }
    setDraft((current) => ({
      ...current,
      vin: v,
      vehicle: decoded.vehicle || current.vehicle,
      vehicleBody: decoded.body || current.vehicleBody,
      vehicleCylinders: decoded.cylinders || current.vehicleCylinders,
      vehicleFuel: decoded.fuel || current.vehicleFuel,
    }));
    setVinStatus("ok");
  }

  // Upload a captured document photo to private storage and return its path.
  async function uploadDealDoc(leadId: string, kind: "license" | "insurance", image: string): Promise<string | null> {
    try {
      const res = await fetch("/api/deal-docs", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ leadId, kind, image }),
      });
      const data = (await res.json().catch(() => ({}))) as { path?: string };
      return res.ok && data.path ? data.path : null;
    } catch {
      return null;
    }
  }

  // Open an on-file document via a short-lived signed URL.
  async function viewDealDoc(path: string) {
    const tab = window.open("", "_blank");
    try {
      const res = await fetch(`/api/deal-docs?path=${encodeURIComponent(path)}`, { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as { url?: string };
      if (data.url && tab) tab.location.href = data.url;
      else tab?.close();
    } catch {
      tab?.close();
    }
  }

  async function addLead() {
    if (!buildCustomerName(draft).trim()) return;
    const leadId = editingId || `CRM-${Date.now()}`;
    // File any freshly captured documents first, so the lead carries their paths.
    const docPatch: Partial<Lead> = {};
    if (pendingDocs.license) {
      const path = await uploadDealDoc(leadId, "license", pendingDocs.license);
      if (path) docPatch.driverLicenseDocPath = path;
    }
    if (pendingDocs.insurance) {
      const path = await uploadDealDoc(leadId, "insurance", pendingDocs.insurance);
      if (path) docPatch.insuranceCardDocPath = path;
    }
    if (editingId) {
      const existing = leads.find((lead) => lead.id === editingId);
      updateLead(editingId, {
        ...preview,
        id: editingId,
        // Editing a lead must never move it to "today": the creation date is
        // history (it anchors the 5:00 clock and every today-count).
        date: existing?.date ?? preview.date,
        status: existing?.status || preview.status,
        inShowroom: existing?.inShowroom,
        // A RESCHEDULED appointment isn't confirmed — someone has to confirm
        // the NEW time. Same time = keep the flag.
        appointmentConfirmed: existing && preview.appointment !== existing.appointment ? false : existing?.appointmentConfirmed,
        ...docPatch,
      });
      setEditingId("");
    } else {
      saveLead({ ...preview, id: leadId, ...docPatch });
    }
    setPendingDocs({});
    setDraft(defaultDraft(salespeople[0] || "", financeManagers[0] || ""));
    setDrawerOpen(false);
  }

  // Deep-link prefill (Equity Radar's "Start opportunity"): /crm-desk?new=1
  // &customer=&vehicle=&source= opens the drawer with the customer typed in —
  // the radar hands you the person, you don't retype them. Plain
  // window.location (not useSearchParams) keeps the page out of a Suspense
  // boundary; the param is stripped after use so refresh doesn't re-open.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "1") return;
    const customer = params.get("customer") || "";
    const [customerFirstName, ...rest] = customer.split(/\s+/);
    setDraft((current) => ({
      ...current,
      customer,
      customerFirstName: customerFirstName || "",
      customerLastName: rest.join(" "),
      vehicle: params.get("vehicle") || current.vehicle,
      source: params.get("source") || current.source,
    }));
    setDrawerOpen(true);
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openNewOpportunity() {
    setEditingId("");
    setPendingDocs({});
    setDraft(defaultDraft(salespeople[0] || "", financeManagers[0] || ""));
    setCustTab("1");
    setIntakeTab("customer");
    setDrawerOpen(true);
  }

  function applyDriverLicenseScan(fields: Record<string, string>) {
    setDraft((current) => ({
      ...current,
      ...fields,
      customer: buildCustomerName({ ...current, ...fields }),
    }));
  }

  function applyInsuranceScan(fields: Record<string, string>) {
    setDraft((current) => ({ ...current, ...fields }));
  }

  function moveLead(id: string, status: LeadStatus) {
    // No lead dies without a reason — marking Lost opens the reason capture first.
    if (status === "Lost") {
      setLostFor(id);
      return;
    }
    const lead = leads.find((l) => l.id === id);
    // Tapping the CURRENT status is a no-op — no duplicate history entries.
    if (lead && lead.status === status) return;
    // Any move off New Lead stops the 5:00 clock — the first status change IS
    // first contact when nobody tapped the phone/email link first.
    const contact = lead ? firstContactPatch(lead) : null;
    updateLead(id, { status, statusHistory: [...(lead?.statusHistory || []), { status, at: new Date().toISOString() }], ...(contact ?? {}) });
  }

  // Opening a customer's name walks into the desk — and only a lead still
  // being WORKED should auto-advance to Desking. Viewing a Won/Lost/In
  // Finance deal must never rewrite its status (that tap used to un-deliver
  // sold cars and grade untouched fresh ups "responded").
  function deskIfWorking(lead: Lead) {
    if (["New Lead", "Working", "Appointment Set", "Shown"].includes(lead.status)) moveLead(lead.id, "Desking");
  }

  // First-contact stamp (the Five-Minute Response clock) — set once, from the
  // phone/email tap or the chip's "Contacted ✓".
  function markContacted(lead: Lead) {
    const patch = firstContactPatch(lead);
    if (patch) updateLead(lead.id, patch);
  }

  // Every consent tap is an append-only audit event (lib/consent.ts), stamped
  // with who recorded it — the trail is the compliance artifact.
  function recordConsent(lead: Lead, event: ConsentEvent) {
    updateLead(lead.id, recordConsentPatch(lead, event));
  }

  // "Your Deal" customer link — the server mints the token (it knows the org
  // and enforces own-customers privacy); we mirror it locally and copy the URL.
  async function shareCustomerLink(lead: Lead) {
    setShareState((cur) => ({ ...cur, [lead.id]: "working" }));
    try {
      const res = await fetch("/api/your-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.path) throw new Error(data?.error || "failed");
      updateLead(lead.id, { shareToken: data.token });
      await navigator.clipboard.writeText(`${window.location.origin}${data.path}`);
      setShareState((cur) => ({ ...cur, [lead.id]: "copied" }));
      setTimeout(() => setShareState((cur) => ({ ...cur, [lead.id]: "idle" })), 2000);
    } catch {
      setShareState((cur) => ({ ...cur, [lead.id]: "error" }));
      setTimeout(() => setShareState((cur) => ({ ...cur, [lead.id]: "idle" })), 2500);
    }
  }

  function commitLost(id: string, reason: string) {
    const lead = leads.find((l) => l.id === id);
    updateLead(id, {
      status: "Lost",
      lostReason: reason,
      statusHistory: [...(lead?.statusHistory || []), { status: "Lost", at: new Date().toISOString() }],
    });
    setLostFor("");
  }

  // The "Customer in Showroom" gate — the manual physical-presence switch.
  function setInShowroom(id: string, on: boolean) {
    updateLead(id, { inShowroom: on });
  }

  function editLead(lead: Lead) {
    setEditingId(lead.id);
    setPendingDocs({});
    setDraft(leadToDraft(lead));
    setCustTab("1");
    setIntakeTab("customer");
    setDrawerOpen(true);
  }

  function cancelEdit() {
    setEditingId("");
    setDrawerOpen(false);
    setDraft(defaultDraft(salespeople[0] || "", financeManagers[0] || ""));
  }

  return (
    <div>
      <SectionHeader title="Showroom" kicker="Leads + desking worksheet" />

      {conflicted && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-[12px] border border-mission-red/50 bg-mission-red/10 p-3 text-sm leading-5 text-mission-red">
          <span><span className="font-black">The board changed on another device</span> — showing the latest. If your last change is missing, re-enter it.</span>
          <button type="button" onClick={clearConflict} className="shrink-0 rounded-full border border-mission-red/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.1em] transition hover:bg-mission-red hover:text-white">Got it</button>
        </div>
      )}

      <div className="mb-5"><NextActionBar read={floorRead} action={floorAction} tone={floorTone} /></div>

      {scanOpen && (
        <LicenseScanner
          onResult={(fields, image) => { applyDriverLicenseScan(fields); setPendingDocs((docs) => ({ ...docs, license: image })); setScanOpen(false); setCustTab("1"); setIntakeTab("customer"); formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          onClose={() => setScanOpen(false)}
        />
      )}

      {insScanOpen && (
        <InsuranceScanner
          onResult={(fields, image) => { applyInsuranceScan(fields); setPendingDocs((docs) => ({ ...docs, insurance: image })); setInsScanOpen(false); setIntakeTab("insurance"); }}
          onClose={() => setInsScanOpen(false)}
        />
      )}

      {/* Tap-to-explain: the card drills into its list; "ask EILA why" hands the
          number to EILA to walk what's counted and the next move. */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <MetricCard label="On The Floor" value={`${showroomFloor.length}`} detail="In the building right now" tone="green" onClick={() => setDrill("showroom")} onExplain={() => askIla("Explain my On The Floor number — who's counted as in the building right now, and what's my next move with each of them?")} />
        <MetricCard label="Deliveries" value={`${deliveries.length}`} detail={`${cameInDeliveries.length} came in · ${remoteDeliveries.length} remote — tap`} tone="gold" onClick={() => setDrill("deliveries")} onExplain={() => askIla("Explain today's Deliveries number — walk the real math in plain words: which deals count, came-in vs remote, and flag anything that looks miscounted.")} />
        <MetricCard label="Today's Ups" value={`${todayLeads.length}`} detail="Came in today — tap for the pipeline" tone="blue" onClick={() => setDrill("today")} onExplain={() => askIla("Explain my Today's Ups number — everyone who came in today, and who needs a touch first?")} />
        <MetricCard
          label="5-Min Response"
          value={speed.breachedNow > 0 ? `${speed.breachedNow} OVER` : speed.onClockNow > 0 ? `${speed.onClockNow} ⏱` : `${speed.under5Pct}%`}
          detail={speed.breachedNow > 0 ? "Fresh ups past 5:00 — tap NOW" : speed.onClockNow > 0 ? "On the clock right now — tap" : `under 5 min, 30 days (avg ${speed.avgMinutes ?? "—"}m)`}
          tone={speed.breachedNow > 0 ? "red" : speed.onClockNow > 0 ? "gold" : "green"}
          onClick={() => setDrill("speed")}
          onExplain={() => askIla("Explain our 5-minute response numbers — who's on the clock or over it right now, this month's percent answered under five minutes by rep, and the fastest way to fix the misses.")}
        />
        <MetricCard label="Appointments" value={`${appointments}`} detail="Scheduled to show" tone="green" onClick={() => setDrill("appointments")} onExplain={() => askIla("Explain today's Appointments number — who's scheduled to show, who's confirmed, and who should I confirm right now?")} />
        <MetricCard label="At Desk Now" value={`${desking}`} detail="At the desk right now" tone="blue" onClick={() => setDrill("desking")} onExplain={() => askIla("Explain my At Desk Now number — who's at the desk this minute and where does each deal stand?")} />
      </section>

      {drillView && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setDrill(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="mt-6 w-full max-w-2xl rounded-[18px] border border-white/12 bg-[#0c0d11] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.7)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-display text-2xl font-black text-white">{drillView.title}</div>
                <div className="mt-1 text-sm text-white/55">
                  {drillView.subtitle} &middot; {drillView.list.length} {drillView.list.length === 1 ? "person" : "people"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrill(null)}
                aria-label="Close"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 text-white/60 transition hover:border-white/30 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-2">
              {drillView.list.length === 0 ? (
                <div className="rounded-[12px] border border-white/8 bg-white/[0.02] p-6 text-center text-sm leading-6 text-white/50">
                  Nobody here right now.
                </div>
              ) : (
                drillView.list.map((lead) => (
                  <div key={lead.id} className="rounded-[12px] border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/desking?lead=${lead.id}`}
                        onClick={() => setDrill(null)}
                        className="font-bold text-white transition hover:text-mission-gold hover:underline"
                      >
                        {lead.customer || "Customer"}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        <SpeedToLeadChip lead={lead} onContacted={() => markContacted(lead)} />
                        <StatusPill tone={lead.status === "Desking" || lead.status === "In Finance" ? "gold" : lead.status === "Won" ? "green" : lead.status === "Lost" ? "red" : "blue"}>{lead.status}</StatusPill>
                      </span>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-white/55">
                      {personLabel(lead.salesperson)} &middot; {lead.vehicle || "TBD"}
                      {drill === "appointments" && lead.appointment ? ` · ${lead.appointment.replace("T", " ")}` : ""}
                      {lead.status === "Lost" && lead.lostReason ? <span className="text-mission-red"> · Lost: {lead.lostReason}</span> : ""}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {lead.inShowroom ? (
                        <button
                          type="button"
                          onClick={() => setInShowroom(lead.id, false)}
                          className="rounded-full border border-mission-green/50 bg-mission-green/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-mission-green transition hover:bg-mission-green/20"
                        >
                          In Showroom ✓
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setInShowroom(lead.id, true)}
                          className="rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/65 transition hover:border-mission-green/50 hover:text-mission-green"
                        >
                          + In Showroom
                        </button>
                      )}
                      {/* Closed deals (Won/Lost) get NO stage buttons — a stray
                          tap in the Sold drill used to un-deliver a car. */}
                      {!["Won", "Lost"].includes(lead.status) && lead.status !== "Shown" && (
                        <button
                          type="button"
                          onClick={() => moveLead(lead.id, "Shown")}
                          className="rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/65 transition hover:border-mission-green/50 hover:text-mission-green"
                        >
                          Mark Shown
                        </button>
                      )}
                      {!["Won", "Lost"].includes(lead.status) && lead.status !== "Desking" && (
                        <button
                          type="button"
                          onClick={() => moveLead(lead.id, "Desking")}
                          className="rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/65 transition hover:border-mission-gold/50 hover:text-mission-gold"
                        >
                          At Desk
                        </button>
                      )}
                      <Link
                        href={`/desking?lead=${lead.id}`}
                        onClick={() => setDrill(null)}
                        className="rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white/65 transition hover:border-white/30 hover:text-white"
                      >
                        Open Deal
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
            {drill === "today" && (
              <button
                type="button"
                onClick={() => setDrill("active")}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[12px] border border-white/12 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/70 transition hover:border-mission-gold/50 hover:text-white"
              >
                View all {active.length} active leads (full pipeline) →
              </button>
            )}
          </div>
        </div>
      )}

      <section className="glass-card mt-5 overflow-hidden rounded-[12px]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-5">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-6 w-6 text-mission-gold" />
            <div>
              <div className="flex items-center gap-2.5">
                <div className="font-display text-2xl font-black text-white">Showroom Board</div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-mission-green/30 bg-mission-green/10 px-2.5 py-1">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mission-green opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-mission-green" />
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-mission-green">Live</span>
                </span>
              </div>
              <div className="text-sm text-white/56">Today: who is in the showroom, who left, and who sold.</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[
              { key: "showroom" as const, label: "In Showroom", value: showroom.length, tone: "text-white" },
              { key: "left" as const, label: "Left", value: left.length, tone: "text-mission-red" },
              { key: "sold" as const, label: "Sold", value: sold.length, tone: "text-mission-green" },
            ].map((stat) => (
              <button
                key={stat.key}
                type="button"
                onClick={() => setDrill(stat.key)}
                className="min-w-[88px] rounded-[12px] border border-white/10 bg-white/[0.03] px-4 py-2 text-center transition hover:border-white/25 hover:bg-white/[0.06]"
              >
                <div className={`font-display text-2xl font-black leading-none ${stat.tone}`}>{stat.value}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">{stat.label}</div>
              </button>
            ))}
          </div>
        </div>
        {todayLeads.length === 0 ? (
          <div className="p-8 text-center text-sm leading-6 text-white/58">No showroom activity today yet. Fresh ups land here as they come in — the full pipeline is under Today&apos;s Active Leads above.</div>
        ) : (
          <>
          {/* Mobile cards */}
          <div className="divide-y divide-white/8 md:hidden">
            {todayLeads.map((lead) => {
              const desk = calculateDesk(lead);
              return (
                <div key={lead.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/desking?lead=${lead.id}`} onClick={() => deskIfWorking(lead)} className="font-bold text-mission-gold">{lead.customer || "Customer"}</Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <SpeedToLeadChip lead={lead} onContacted={() => markContacted(lead)} />
                      <StatusPill tone={lead.status === "Desking" || lead.status === "In Finance" ? "gold" : lead.status === "Won" ? "green" : lead.status === "Lost" ? "red" : "blue"}>{lead.status}</StatusPill>
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-white/50">{lead.stockNumber || "-"} · {lead.vehicle || "TBD"}</div>
                  <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-white/45">Salesperson</span><span className="text-right text-white/80">{personLabel(lead.salesperson)}</span>
                    <span className="text-white/45">F&amp;I</span><span className="text-right text-white/80">{personLabel(lead.financeManager)}</span>
                    <span className="text-white/45">Front</span><span className={desk.frontProfit >= 0 ? "text-right font-black text-mission-green" : "text-right font-black text-mission-red"}>{currency(desk.frontProfit)}</span>
                    <span className="text-white/45">Payment</span><span className="text-right font-black text-white">{currency(desk.payment)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusPill tone={lead.creditStatus === "Approved" ? "green" : lead.creditStatus === "Declined" ? "red" : "blue"}>{lead.creditStatus}</StatusPill>
                    {lead.nextAction && <span className="text-xs text-white/45">Next: {lead.nextAction}</span>}
                  </div>
                  <button type="button" onClick={() => openWorksheetPrint(lead.id)} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-mission-gold px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
                    <Printer className="h-4 w-4" /> Worksheet
                  </button>
                </div>
              );
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1320px] text-left text-sm">
              <thead>
                <tr className="border-b border-mission-gold/20 bg-mission-gold/10">
                  {["Customer", "Salesperson", "F&I", "Unit", "Trade", "Credit App", "Status", "Front", "Payment", "Worksheet", "Next Action"].map((heading) => (
                    <th key={heading} className="px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {todayLeads.map((lead) => (
                  <tr key={lead.id} className="border-b border-white/8 hover:bg-white/[0.04]">
                    <td className="px-4 py-4 font-bold text-white">
                      <Link href={`/desking?lead=${lead.id}`} onClick={() => deskIfWorking(lead)} className="text-mission-gold underline-offset-2 transition hover:underline">
                        {lead.customer || "Customer"}
                      </Link>
                    </td>
                    <td className="px-4 py-4 text-white/70">{personLabel(lead.salesperson)}</td>
                    <td className="px-4 py-4 text-white/70">{personLabel(lead.financeManager)}</td>
                    <td className="px-4 py-4 text-white/70">{lead.stockNumber || "-"} | {lead.vehicle || "TBD"}{lead.vehicleMiles ? ` | ${numberFormat.format(lead.vehicleMiles)} mi` : ""}</td>
                    <td className="px-4 py-4 text-white/70">{tradeSummary(lead) || (lead.tradeValue ? currency(lead.tradeValue) : "No trade")}</td>
                    <td className="px-4 py-4"><StatusPill tone={lead.creditStatus === "Approved" ? "green" : lead.creditStatus === "Declined" ? "red" : "blue"}>{lead.creditStatus}</StatusPill></td>
                    <td className="px-4 py-4">
                      <span className="flex items-center gap-2">
                        <StatusPill tone={lead.status === "Desking" || lead.status === "In Finance" ? "gold" : lead.status === "Won" ? "green" : lead.status === "Lost" ? "red" : "blue"}>{lead.status}</StatusPill>
                        <SpeedToLeadChip lead={lead} onContacted={() => markContacted(lead)} />
                      </span>
                    </td>
                    <td className={calculateDesk(lead).frontProfit >= 0 ? "px-4 py-4 font-black text-mission-green" : "px-4 py-4 font-black text-mission-red"}>{currency(calculateDesk(lead).frontProfit)}</td>
                    <td className="px-4 py-4 font-black text-white">{currency(calculateDesk(lead).payment)}</td>
                    <td className="px-4 py-4">
                      <button type="button" onClick={() => openWorksheetPrint(lead.id)} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-mission-gold px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
                        <Printer className="h-4 w-4" />
                        Worksheet
                      </button>
                    </td>
                    <td className="px-4 py-4 text-white/58">{lead.nextAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      <section className="mt-5">
        <div className="mb-5">
          <div className="mb-3 font-display text-xl font-black text-white">On the floor now</div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={openNewOpportunity} className="inline-flex min-h-[3.6rem] items-center justify-center gap-2.5 rounded-[16px] bg-mission-gold px-5 text-[15px] font-black uppercase tracking-[0.08em] text-mission-navy shadow-gold transition hover:brightness-110">
              <Send className="h-5 w-5" /> New Opportunity
            </button>
            <button type="button" onClick={() => { openNewOpportunity(); setScanOpen(true); }} className="inline-flex min-h-[3.6rem] items-center justify-center gap-2.5 rounded-[16px] border-2 border-mission-gold/55 bg-mission-gold/[0.06] px-5 text-[15px] font-black uppercase tracking-[0.08em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
              <ScanLine className="h-5 w-5" /> Scan License
            </button>
          </div>
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-[70] flex justify-end bg-black/55 backdrop-blur-sm" onClick={() => setDrawerOpen(false)}>
            <aside ref={formRef} onClick={(event) => event.stopPropagation()} className="lg-glass flex h-full w-full max-w-xl flex-col overflow-hidden rounded-l-[18px]">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 p-5">
                <div className="flex items-center gap-3">
                  <FilePenLine className="h-5 w-5 text-mission-gold" />
                  <div className="font-display text-2xl font-black text-white">{editingId ? "Edit Opportunity" : "New Opportunity"}</div>
                  {editingId && <StatusPill tone="gold">Editing</StatusPill>}
                </div>
                <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10"><X className="h-4 w-4" /></button>
              </div>
              <div className="flex flex-wrap gap-1.5 border-b border-white/10 px-5 py-3">
                {(([["customer", "Customer"], ["vehicle", "Vehicle"], ["team", "Team"], ["credit", "Credit"], ["trade", "Trade"], ["insurance", "Insurance"], ...(editingId ? [["journey", "Journey"]] : [])]) as [typeof intakeTab, string][]).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setIntakeTab(key)} className={`rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] transition ${intakeTab === key ? "bg-mission-gold text-mission-navy" : "border border-white/12 text-white/60 hover:text-white"}`}>{label}</button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <div className="grid gap-4">
            <div className={`rounded-[12px] border border-white/10 bg-white/[0.035] p-4 ${intakeTab !== "customer" ? "hidden" : ""}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Customers</div>
                </div>
                {custTab === "1" && (
                  <button
                    type="button"
                    onClick={() => setScanOpen(true)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-mission-gold/35 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy"
                  >
                    <ScanLine className="h-4 w-4" />
                    Scan Driver&apos;s License
                  </button>
                )}
              </div>

              {custTab === "1" && <DocOnFile captured={!!pendingDocs.license} path={editingLead?.driverLicenseDocPath} label="license" onView={viewDealDoc} />}

              {/* Apple-style segmented control */}
              <div className="relative mb-4 flex rounded-full border border-white/10 bg-[#14161c]/70 p-1">
                <span
                  aria-hidden
                  className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-mission-gold shadow-gold transition-transform duration-300 ease-out ${custTab === "2" ? "translate-x-full" : "translate-x-0"}`}
                />
                <button type="button" onClick={() => setCustTab("1")} className={`relative z-10 flex-1 rounded-full py-2 text-xs font-black uppercase tracking-[0.12em] transition-colors duration-200 ${custTab === "1" ? "text-mission-navy" : "text-white/60 hover:text-white"}`}>
                  Customer 1
                </button>
                <button type="button" onClick={() => setCustTab("2")} className={`relative z-10 flex-1 rounded-full py-2 text-xs font-black uppercase tracking-[0.12em] transition-colors duration-200 ${custTab === "2" ? "text-mission-navy" : "text-white/60 hover:text-white"}`}>
                  Customer 2{buildCoBuyerName(draft) ? " ✓" : ""}
                </button>
              </div>

              {custTab === "1" ? (
                <div key="cust1" className="tab-fade grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr_92px]">
                    <Field label="First Name"><input className={inputClass} value={draft.customerFirstName} onChange={(event) => update("customerFirstName", event.target.value)} placeholder="First" /></Field>
                    <Field label="Middle Name"><input className={inputClass} value={draft.customerMiddleName} onChange={(event) => update("customerMiddleName", event.target.value)} placeholder="Middle" /></Field>
                    <Field label="Last Name"><input className={inputClass} value={draft.customerLastName} onChange={(event) => update("customerLastName", event.target.value)} placeholder="Last" /></Field>
                    <Field label="Suffix">
                      <select className={inputClass} value={draft.customerSuffix} onChange={(event) => update("customerSuffix", event.target.value)}>
                        {suffixOptions.map((suffix) => (
                          <option key={suffix || "none"} value={suffix}>{suffix || "-"}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="rounded-[12px] border border-white/10 bg-[#14161c]/65 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-white/42">Full Name Preview</div>
                    <div className="mt-1 min-h-7 text-lg font-black text-white">{buildCustomerName(draft) || "Enter customer name"}</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Phone"><input className={inputClass} value={draft.customerPhone} onChange={(event) => update("customerPhone", event.target.value)} placeholder="Customer phone" /></Field>
                    <Field label="Email"><input className={inputClass} value={draft.customerEmail} onChange={(event) => update("customerEmail", event.target.value)} placeholder="Customer email" /></Field>
                  </div>
                  <Field label="Address"><input className={inputClass} value={draft.customerAddress} onChange={(event) => update("customerAddress", event.target.value)} placeholder="Street address" /></Field>
                  <div className="grid gap-3 sm:grid-cols-[1fr_82px_110px]">
                    <Field label="City"><input className={inputClass} value={draft.customerCity} onChange={(event) => update("customerCity", event.target.value)} placeholder="City" /></Field>
                    <Field label="State"><input className={inputClass} value={draft.customerState} onChange={(event) => update("customerState", event.target.value)} placeholder="GA" /></Field>
                    <Field label="Zip"><input className={inputClass} value={draft.customerZip} onChange={(event) => update("customerZip", event.target.value)} placeholder="Zip" /></Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Driver's License #"><input className={inputClass} value={draft.driversLicense} onChange={(event) => update("driversLicense", event.target.value.toUpperCase())} placeholder="DL number" /></Field>
                    <Field label="DL State"><input className={inputClass} value={draft.dlState} onChange={(event) => update("dlState", event.target.value.toUpperCase())} placeholder="GA" /></Field>
                    <Field label="Date of Birth"><input className={inputClass} type="date" value={draft.dob} onChange={(event) => update("dob", event.target.value)} /></Field>
                    <Field label="County of Residence"><input className={inputClass} value={draft.county} onChange={(event) => update("county", event.target.value)} placeholder="Cobb" /></Field>
                  </div>
                  <Field label="Source">
                    <select className={inputClass} value={draft.source} onChange={(event) => update("source", event.target.value)}>
                      {["Showroom", "Phone", "Internet", "Service Drive", "Equity Mining", "Referral", "BDC"].map((source) => <option key={source}>{source}</option>)}
                    </select>
                  </Field>
                </div>
              ) : (
                <div key="cust2" className="tab-fade grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs leading-5 text-white/46">Co-buyer / second owner</div>
                    <button type="button" onClick={copyAddressToCoBuyer} className="rounded-full border border-mission-gold/35 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">Same address as Customer 1</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr_92px]">
                    <Field label="First Name"><input className={inputClass} value={draft.coBuyerFirstName} onChange={(event) => update("coBuyerFirstName", event.target.value)} placeholder="First" /></Field>
                    <Field label="Middle Name"><input className={inputClass} value={draft.coBuyerMiddleName} onChange={(event) => update("coBuyerMiddleName", event.target.value)} placeholder="Middle" /></Field>
                    <Field label="Last Name"><input className={inputClass} value={draft.coBuyerLastName} onChange={(event) => update("coBuyerLastName", event.target.value)} placeholder="Last" /></Field>
                    <Field label="Suffix">
                      <select className={inputClass} value={draft.coBuyerSuffix} onChange={(event) => update("coBuyerSuffix", event.target.value)}>
                        {suffixOptions.map((suffix) => (
                          <option key={suffix || "none"} value={suffix}>{suffix || "-"}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="rounded-[12px] border border-white/10 bg-[#14161c]/65 p-3">
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-white/42">Co-Buyer Name Preview</div>
                    <div className="mt-1 min-h-7 text-lg font-black text-white">{buildCoBuyerName(draft) || "No co-buyer"}</div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Phone"><input className={inputClass} value={draft.coBuyerPhone} onChange={(event) => update("coBuyerPhone", event.target.value)} placeholder="Co-buyer phone" /></Field>
                    <Field label="Email"><input className={inputClass} value={draft.coBuyerEmail} onChange={(event) => update("coBuyerEmail", event.target.value)} placeholder="Co-buyer email" /></Field>
                  </div>
                  <Field label="Address"><input className={inputClass} value={draft.coBuyerAddress} onChange={(event) => update("coBuyerAddress", event.target.value)} placeholder="Street address" /></Field>
                  <div className="grid gap-3 sm:grid-cols-[1fr_82px_110px]">
                    <Field label="City"><input className={inputClass} value={draft.coBuyerCity} onChange={(event) => update("coBuyerCity", event.target.value)} placeholder="City" /></Field>
                    <Field label="State"><input className={inputClass} value={draft.coBuyerState} onChange={(event) => update("coBuyerState", event.target.value)} placeholder="GA" /></Field>
                    <Field label="Zip"><input className={inputClass} value={draft.coBuyerZip} onChange={(event) => update("coBuyerZip", event.target.value)} placeholder="Zip" /></Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Driver's License #"><input className={inputClass} value={draft.coBuyerDl} onChange={(event) => update("coBuyerDl", event.target.value.toUpperCase())} placeholder="DL number" /></Field>
                    <Field label="DL State"><input className={inputClass} value={draft.coBuyerDlState} onChange={(event) => update("coBuyerDlState", event.target.value.toUpperCase())} placeholder="GA" /></Field>
                    <Field label="Date of Birth"><input className={inputClass} type="date" value={draft.coBuyerDob} onChange={(event) => update("coBuyerDob", event.target.value)} /></Field>
                    <Field label="County of Residence"><input className={inputClass} value={draft.coBuyerCounty} onChange={(event) => update("coBuyerCounty", event.target.value)} placeholder="Cobb" /></Field>
                  </div>
                </div>
              )}
            </div>

            <div className={`rounded-[12px] border border-white/10 bg-white/[0.035] p-4 ${intakeTab !== "vehicle" ? "hidden" : ""}`}>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Vehicle</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vehicle"><input className={inputClass} value={draft.vehicle} onChange={(event) => update("vehicle", event.target.value)} placeholder="2023 Mazda CX-5" /></Field>
                <Field label="VIN">
                  <input className={inputClass} value={draft.vin} onChange={(event) => handleVinChange(event.target.value)} placeholder="17-character VIN — auto-decodes" maxLength={17} />
                  {vinStatus === "decoding" && <div className="mt-1 text-xs font-bold text-mission-gold">Decoding VIN…</div>}
                  {vinStatus === "ok" && <div className="mt-1 text-xs font-bold text-mission-green">✓ Vehicle decoded from VIN</div>}
                  {vinStatus === "fail" && <div className="mt-1 text-xs font-bold text-mission-red">Couldn&apos;t decode — enter vehicle manually</div>}
                </Field>
                <Field label="Stock / Unit"><input className={inputClass} value={draft.stockNumber} onChange={(event) => update("stockNumber", event.target.value)} placeholder="Stock number" /></Field>
                <Field label="Vehicle Miles"><input className={inputClass} type="number" value={draft.vehicleMiles} onChange={(event) => update("vehicleMiles", event.target.value)} placeholder="Miles on unit" /></Field>
                <Field label="Vehicle Type">
                  <select className={inputClass} value={draft.vehicleClass} onChange={(event) => update("vehicleClass", event.target.value)}>
                    <option>New</option>
                    <option>Used</option>
                    <option>Lease</option>
                  </select>
                </Field>
                <Field label="Color"><input className={inputClass} value={draft.vehicleColor} onChange={(event) => update("vehicleColor", event.target.value)} placeholder="Color" /></Field>
                <Field label="Body Style"><input className={inputClass} value={draft.vehicleBody} onChange={(event) => update("vehicleBody", event.target.value)} placeholder="4D SUV, Sedan…" /></Field>
                <Field label="Cylinders"><input className={inputClass} value={draft.vehicleCylinders} onChange={(event) => update("vehicleCylinders", event.target.value)} placeholder="4 / 6 / 8" /></Field>
                <Field label="Fuel"><input className={inputClass} value={draft.vehicleFuel} onChange={(event) => update("vehicleFuel", event.target.value)} placeholder="Gas / Hybrid / EV" /></Field>
                <Field label="Current Title # (used)"><input className={inputClass} value={draft.currentTitle} onChange={(event) => update("currentTitle", event.target.value)} placeholder="Prior title number" /></Field>
              </div>
            </div>

            <div className={`rounded-[12px] border border-white/10 bg-white/[0.035] p-4 ${intakeTab !== "team" ? "hidden" : ""}`}>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Team &amp; Status</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Salesperson">
                  <select className={inputClass} value={draft.salesperson} onChange={(event) => update("salesperson", event.target.value)}>
                    {salespeople.map((person) => <option key={person} value={person}>{personLabel(person)}</option>)}
                  </select>
                </Field>
                <Field label="Desk Manager">
                  <select className={inputClass} value={draft.deskManager} onChange={(event) => update("deskManager", event.target.value)}>
                    <option value="">Unassigned</option>
                    {managers.map((person) => <option key={person} value={person}>{personLabel(person)}</option>)}
                  </select>
                </Field>
                <Field label="F&I Manager">
                  <select className={inputClass} value={draft.financeManager} onChange={(event) => update("financeManager", event.target.value)}>
                    {financeManagers.map((person) => <option key={person} value={person}>{personLabel(person)}</option>)}
                  </select>
                </Field>
                <Field label="Credit App">
                  <select className={inputClass} value={draft.creditStatus} onChange={(event) => update("creditStatus", event.target.value)}>
                    {creditStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <div className={`rounded-[12px] border border-white/10 bg-white/[0.035] p-4 ${intakeTab !== "credit" ? "hidden" : ""}`}>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Credit Snapshot</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Credit Score"><input className={inputClass} value={draft.creditScore} onChange={(event) => update("creditScore", event.target.value)} placeholder="Score / range" /></Field>
                <Field label="Monthly Income"><input className={inputClass} value={draft.monthlyIncome} onChange={(event) => update("monthlyIncome", event.target.value)} placeholder="Monthly gross" /></Field>
                <Field label="Employer"><input className={inputClass} value={draft.employer} onChange={(event) => update("employer", event.target.value)} placeholder="Employer" /></Field>
                <Field label="Residence"><input className={inputClass} value={draft.residenceStatus} onChange={(event) => update("residenceStatus", event.target.value)} placeholder="Own / rent / time there" /></Field>
              </div>
            </div>

            <div className={`rounded-[12px] border border-white/10 bg-white/[0.035] p-4 ${intakeTab !== "team" ? "hidden" : ""}`}>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Schedule</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Appointment"><input className={inputClass} type="datetime-local" value={draft.appointment} onChange={(event) => update("appointment", event.target.value)} /></Field>
                <Field label="Next Action"><input className={inputClass} value={draft.nextAction} onChange={(event) => update("nextAction", event.target.value)} /></Field>
              </div>
            </div>
          </div>

          <div className={`mt-5 rounded-[12px] border border-white/10 bg-white/[0.035] p-4 ${intakeTab !== "trade" ? "hidden" : ""}`}>
            <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Trade Details</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Trade Year"><input className={inputClass} value={draft.tradeYear} onChange={(event) => update("tradeYear", event.target.value)} placeholder="Year" /></Field>
              <Field label="Trade Make"><input className={inputClass} value={draft.tradeMake} onChange={(event) => update("tradeMake", event.target.value)} placeholder="Make" /></Field>
              <Field label="Trade Model"><input className={inputClass} value={draft.tradeModel} onChange={(event) => update("tradeModel", event.target.value)} placeholder="Model" /></Field>
              <Field label="Trade Miles"><input className={inputClass} type="number" value={draft.tradeMiles} onChange={(event) => update("tradeMiles", event.target.value)} placeholder="Miles" /></Field>
              <Field label="Trade Payoff"><input className={inputClass} type="number" value={draft.payoff} onChange={(event) => update("payoff", event.target.value)} placeholder="Payoff" /></Field>
              <Field label="Payoff Source"><input className={inputClass} value={draft.tradePayoffSource} onChange={(event) => update("tradePayoffSource", event.target.value)} placeholder="Bank / source" /></Field>
              <Field label="Trade ACV"><input className={inputClass} type="number" value={draft.tradeAcv} onChange={(event) => update("tradeAcv", event.target.value)} placeholder="ACV" /></Field>
              <Field label="Allowance"><input className={inputClass} type="number" value={draft.tradeValue} onChange={(event) => update("tradeValue", event.target.value)} placeholder="Shown trade value" /></Field>
              <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 py-2.5 text-sm font-bold text-white/75 sm:col-span-2">
                <input type="checkbox" checked={draft.taxCreditEnabled} onChange={(event) => update("taxCreditEnabled", event.target.checked)} className="h-5 w-5 shrink-0 accent-mission-gold" />
                <span className="leading-tight">
                  Customer gets tax credit for this trade
                  <span className="mt-0.5 block text-[10px] font-medium text-white/40">Uncheck if they don&apos;t qualify — a leased trade, or one titled in someone else&apos;s name (not on the new loan)</span>
                </span>
              </label>
            </div>
            <Field label="ACV / Trade Notes"><textarea className="min-h-[78px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-mission-gold/60" value={draft.tradeNotes} onChange={(event) => update("tradeNotes", event.target.value)} placeholder="Condition, payoff notes, title, appraisal notes, recon concerns" /></Field>
          </div>

          <div className={`mt-5 rounded-[12px] border border-white/10 bg-white/[0.035] p-4 ${intakeTab !== "insurance" ? "hidden" : ""}`}>
            <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-mission-gold">Lienholder &amp; Insurance</div>
            <button type="button" onClick={() => setInsScanOpen(true)} className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-[12px] border-2 border-mission-green/50 bg-mission-green/[0.06] px-4 py-3 text-sm font-black uppercase tracking-[0.08em] text-mission-green transition hover:bg-mission-green hover:text-mission-navy">
              <ShieldCheck className="h-5 w-5" /> Scan insurance card with EILA
            </button>
            <DocOnFile captured={!!pendingDocs.insurance} path={editingLead?.insuranceCardDocPath} label="insurance card" onView={viewDealDoc} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Lienholder Name"><input className={inputClass} value={draft.lienName} onChange={(event) => update("lienName", event.target.value)} placeholder="Bank / lender" /></Field>
              <Field label="Lienholder Address"><input className={inputClass} value={draft.lienAddress} onChange={(event) => update("lienAddress", event.target.value)} placeholder="Lienholder address" /></Field>
              <Field label="Insurance Company"><input className={inputClass} value={draft.insuranceCompany} onChange={(event) => update("insuranceCompany", event.target.value)} placeholder="Carrier" /></Field>
              <Field label="Policy #"><input className={inputClass} value={draft.insurancePolicy} onChange={(event) => update("insurancePolicy", event.target.value)} placeholder="Policy number" /></Field>
              <Field label="Agent Name"><input className={inputClass} value={draft.insuranceAgentName} onChange={(event) => update("insuranceAgentName", event.target.value)} placeholder="Agent" /></Field>
              <Field label="Agent Phone"><input className={inputClass} value={draft.insuranceAgentPhone} onChange={(event) => update("insuranceAgentPhone", event.target.value)} placeholder="Agent phone" /></Field>
              <Field label="Agent Address"><input className={inputClass} value={draft.insuranceAgentAddress} onChange={(event) => update("insuranceAgentAddress", event.target.value)} placeholder="Agent address" /></Field>
              <Field label="Coverage Effective From"><input className={inputClass} type="date" value={draft.insuranceEffectiveFrom} onChange={(event) => update("insuranceEffectiveFrom", event.target.value)} /></Field>
              <Field label="Coverage Effective To"><input className={inputClass} type="date" value={draft.insuranceEffectiveTo} onChange={(event) => update("insuranceEffectiveTo", event.target.value)} /></Field>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <CoverageToggle label="Comprehensive" on={draft.coverageComprehensive} onToggle={() => update("coverageComprehensive", !draft.coverageComprehensive)} deductible={draft.deductibleComprehensive} onDeductible={(v) => update("deductibleComprehensive", v)} />
              <CoverageToggle label="Collision" on={draft.coverageCollision} onToggle={() => update("coverageCollision", !draft.coverageCollision)} deductible={draft.deductibleCollision} onDeductible={(v) => update("deductibleCollision", v)} />
              <CoverageToggle label="Fire / Theft" on={draft.coverageFireTheft} onToggle={() => update("coverageFireTheft", !draft.coverageFireTheft)} deductible={draft.deductibleFireTheft} onDeductible={(v) => update("deductibleFireTheft", v)} />
            </div>
          </div>

          <div className={`grid gap-3 ${intakeTab !== "insurance" ? "hidden" : ""}`}>
            <Field label="We Owe"><textarea className="min-h-[78px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none focus:border-mission-gold/60" value={draft.weOwe} onChange={(event) => update("weOwe", event.target.value)} placeholder="Detail, tint, second key, repairs, accessories..." /></Field>
            <Field label="Salesperson Notes (for follow-up)"><textarea className="min-h-[92px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none focus:border-mission-gold/60" value={draft.notes} onChange={(event) => update("notes", event.target.value)} placeholder="What they liked, objections, who else is shopping, best time to reach them — anything for the follow-up if they don't buy today." /></Field>
            <Field label="Sales Manager Notes"><textarea className="min-h-[78px] w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 p-3 text-sm text-white outline-none focus:border-mission-gold/60" value={draft.managerNotes} onChange={(event) => update("managerNotes", event.target.value)} placeholder="Desk read, structure, what it takes to close, coaching for the rep." /></Field>
          </div>
          {editingId && (
            <div className={`mt-5 rounded-[12px] border border-white/10 bg-white/[0.035] p-4 ${intakeTab !== "journey" ? "hidden" : ""}`}>
              <CustomerJourney lead={editingLead} />
            </div>
          )}
              </div>
              <div className="flex gap-2 border-t border-white/10 p-5">
                <button type="button" onClick={addLead} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-mission-gold px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-mission-navy shadow-gold transition hover:brightness-110">
                  <Send className="h-4 w-4" />
                  {editingId ? "Save Opportunity" : "Add Opportunity"}
                </button>
                <button type="button" onClick={cancelEdit} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white/70 transition hover:border-mission-gold/50 hover:text-white">
                  {editingId ? "Cancel" : "Close"}
                </button>
              </div>
            </aside>
          </div>
        )}

        <main className="space-y-4">
          {showroomFloor.length === 0 ? (
            <div className="glass-card rounded-[16px] p-8 text-center sm:p-12">
              <Radar className="mx-auto h-9 w-9 text-mission-gold" />
              <div className="mt-4 font-display text-2xl font-black text-white">Put someone on the board</div>
              <p className="mx-auto mt-1.5 max-w-xs text-sm text-white/55">Tap <span className="font-bold text-mission-gold">New Opportunity</span> or <span className="font-bold text-mission-gold">Scan License</span> up top to start a deal.</p>
            </div>
          ) : (
            showroomFloor.map((lead) => (
              <article key={lead.id} className="glass-card rounded-[12px] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={lead.status === "Desking" || lead.status === "In Finance" ? "gold" : lead.status === "Won" ? "green" : lead.status === "Lost" ? "red" : "blue"}>{lead.status}</StatusPill>
                      <StatusPill tone="blue">{lead.source}</StatusPill>
                      {(() => { const sc = scoreLead(lead); return <StatusPill tone={sc.label === "Hot" ? "red" : sc.label === "Warm" ? "gold" : sc.label === "Nurture" ? "green" : "blue"}>{sc.score} · {sc.label}</StatusPill>; })()}
                    </div>
                    <div className="mt-3 font-display text-3xl font-black text-white">{lead.customer}</div>
                    <div className="mt-1 text-sm font-bold uppercase tracking-[0.14em] text-mission-gold">{lead.vehicle || "Vehicle TBD"}</div>
                    <div className="mt-3 grid gap-2 text-sm text-white/62 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                      <Info icon={PhoneCall} label="Salesperson" value={personLabel(lead.salesperson)} />
                      <Info icon={UserCog} label="Desk" value={lead.deskManager ? personLabel(lead.deskManager) : "Unassigned"} />
                      <Info icon={BadgeCheck} label="F&I" value={personLabel(lead.financeManager)} />
                      <Info icon={CalendarClock} label="Appointment" value={lead.appointment ? lead.appointment.replace("T", " ") : "Not set"} />
                      <Info icon={Calculator} label="Payment" value={currency(calculateDesk(lead).payment)} />
                      <Info icon={BadgeCheck} label="Credit App" value={lead.creditStatus} />
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-white/62 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
                      {/* Tapping the number/email IS first contact — it stops the 5:00 clock.
                          A revoked channel loses its live link entirely (TCPA rail). */}
                      {(() => {
                        const call = canContact(lead, "call");
                        const email = canContact(lead, "email");
                        return (
                          <>
                            <Info icon={PhoneCall} label="Phone" value={call.allowed ? lead.customerPhone || "Not entered" : "REVOKED — do not call"} href={call.allowed && lead.customerPhone ? `tel:${lead.customerPhone.replace(/[^0-9+]/g, "")}` : undefined} onUse={() => markContacted(lead)} />
                            <Info icon={Send} label="Email" value={email.allowed ? lead.customerEmail || "Not entered" : "REVOKED — do not email"} href={email.allowed && lead.customerEmail ? `mailto:${lead.customerEmail}` : undefined} onUse={() => markContacted(lead)} />
                          </>
                        );
                      })()}
                      <Info icon={Radar} label="Trade" value={tradeSummary(lead) || "No trade entered"} />
                    </div>
                    <div className="mt-3">
                      <ConsentChips lead={lead} by={profile?.displayName} onRecord={(event) => recordConsent(lead, event)} />
                    </div>
                    {lead.notes && <p className="mt-4 text-sm leading-6 text-white/58"><span className="font-bold uppercase tracking-[0.1em] text-white/40">Salesperson · </span>{lead.notes}</p>}
                    {lead.managerNotes && <p className="mt-2 text-sm leading-6 text-white/58"><span className="font-bold uppercase tracking-[0.1em] text-mission-gold/70">Sales Manager · </span>{lead.managerNotes}</p>}
                    <div className="mt-4 rounded-[12px] border border-white/8 bg-white/[0.02] p-4">
                      <DealProgress
                        progress={lead.progress}
                        onToggle={(step: DealStep) => updateLead(lead.id, { progress: { ...(lead.progress || {}), [step]: !(lead.progress?.[step]) } })}
                      />
                    </div>
                    {aiAssistantOn && <CrmAiPanel lead={lead} />}
                    <PrintableForms lead={lead} />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => requestTO(lead)} disabled={toRequested[lead.id]} className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${toRequested[lead.id] ? "border border-mission-green/40 bg-mission-green/10 text-mission-green" : "bg-mission-red px-3 text-white hover:brightness-110"}`}>
                        <ShieldCheck className="h-4 w-4" />
                        {toRequested[lead.id] ? "Manager alerted" : "Request TO"}
                      </button>
                      <button type="button" onClick={() => openWorksheetPrint(lead.id)} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-mission-gold px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
                        <Printer className="h-4 w-4" />
                        Customer Worksheet
                      </button>
                      <button type="button" onClick={() => setTextingId(lead.id)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-mission-gold/35 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
                        <Send className="h-4 w-4" />
                        Text{(lead.messages?.length ?? 0) > 0 ? ` (${lead.messages!.length})` : ""}
                      </button>
                      <button type="button" onClick={() => void shareCustomerLink(lead)} disabled={shareState[lead.id] === "working"} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-mission-green/40 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-green transition hover:bg-mission-green hover:text-mission-navy disabled:opacity-50">
                        <Link2 className="h-4 w-4" />
                        {shareState[lead.id] === "copied" ? "Link copied!" : shareState[lead.id] === "error" ? "Try again" : "Customer Link"}
                      </button>
                      <button type="button" onClick={() => editLead(lead)} className="rounded-full border border-mission-gold/35 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">Edit</button>
                      <button type="button" onClick={() => deleteLead(lead.id)} className="rounded-full border border-mission-red/40 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-red transition hover:bg-mission-red hover:text-white">Delete</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:max-w-[260px] lg:justify-end">
                    {statuses.map((status) => (
                      <button key={status} type="button" onClick={() => moveLead(lead.id, status)} className="rounded-full border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/56 transition hover:border-mission-gold/50 hover:text-mission-gold">
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))
          )}
        </main>
      </section>

      {lostFor && (
        <LostReasonModal
          name={leads.find((l) => l.id === lostFor)?.customer || "this customer"}
          onPick={(reason) => commitLost(lostFor, reason)}
          onClose={() => setLostFor("")}
        />
      )}

      {textingId && (() => {
        const lead = leads.find((l) => l.id === textingId);
        if (!lead) return null;
        return (
          <TextThread
            lead={lead}
            onClose={() => setTextingId("")}
            // The server already wrote the message; mirror it locally so the
            // bubble appears instantly (the heartbeat reconciles anyway).
            onSent={(message) => updateLead(lead.id, { ...appendMessagePatch(lead, message), ...(lead.firstContactAt ? {} : { firstContactAt: message.at }) })}
          />
        );
      })()}
    </div>
  );
}

const LOST_REASONS = [
  "Payment too high",
  "Trade value",
  "Credit",
  "Vehicle unavailable",
  "Shopping a competitor",
  "Needed spouse",
  "Wanted to think",
  "Bad experience",
  "Could not contact",
  "No show",
];

// No lead is marked Lost without a reason a manager can act on.
function LostReasonModal({ name, onPick, onClose }: { name: string; onPick: (reason: string) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-panel relative w-full max-w-md rounded-t-[20px] p-5 sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="font-display text-xl font-black text-white">Why did we lose {name}?</div>
            <div className="mt-0.5 text-xs text-white/50">Capture the reason so a manager can work the save.</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {LOST_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => onPick(reason)}
              className="rounded-[12px] border border-white/10 bg-white/[0.03] px-3 py-3 text-left text-sm font-bold text-white/80 transition hover:border-mission-red/45 hover:bg-mission-red/10 hover:text-white"
            >
              {reason}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-white/42">{label}</span>
      {children}
    </label>
  );
}

// A compact "document on file" confirmation row — shown once a license or
// insurance card has been captured this session (saves with the deal) or is
// already filed on the lead (with a tap to view it via a signed URL).
function DocOnFile({ captured, path, label, onView }: { captured: boolean; path?: string; label: string; onView: (path: string) => void }) {
  if (!captured && !path) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-[10px] border border-mission-green/25 bg-mission-green/[0.05] px-3 py-2 text-xs font-bold text-mission-green">
      <span className="inline-flex items-center gap-1.5">
        <BadgeCheck className="h-4 w-4" />
        {captured ? `New ${label} photo — saves with the deal` : `${label.charAt(0).toUpperCase()}${label.slice(1)} on file`}
      </span>
      {!captured && path && (
        <button type="button" onClick={() => onView(path)} className="inline-flex items-center gap-1 text-white/70 transition hover:text-white">
          <Eye className="h-3.5 w-3.5" /> View
        </button>
      )}
    </div>
  );
}

function CoverageToggle({ label, on, onToggle, deductible, onDeductible }: { label: string; on: boolean; onToggle: () => void; deductible: string; onDeductible: (value: string) => void }) {
  return (
    <div className={`rounded-[12px] border p-3 ${on ? "border-mission-gold/50 bg-mission-gold/10" : "border-white/10 bg-[#14161c]/70"}`}>
      <button type="button" onClick={onToggle} className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-white">
        <span className={`grid h-4 w-4 place-items-center rounded border ${on ? "border-mission-gold bg-mission-gold text-mission-navy" : "border-white/30"}`}>{on ? "✓" : ""}</span>
        {label}
      </button>
      <input
        className="mt-2 h-9 w-full rounded-[6px] border border-white/10 bg-[#14161c]/80 px-2 text-xs text-white outline-none focus:border-mission-gold/60"
        value={deductible}
        onChange={(event) => onDeductible(event.target.value)}
        placeholder="Deductible"
        disabled={!on}
      />
    </div>
  );
}

function Info({ icon: Icon, label, value, href, onUse }: { icon: typeof PhoneCall; label: string; value: string; href?: string; onUse?: () => void }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[12px] border border-white/10 bg-white/[0.035] p-3">
      <Icon className="h-4 w-4 text-mission-gold" />
      <div className="mt-2 break-words text-xs font-black uppercase tracking-[0.12em] text-white/38">{label}</div>
      {href ? (
        <a href={href} onClick={onUse} className="mt-1 block break-words font-bold leading-tight text-mission-green underline-offset-2 transition hover:underline">{value}</a>
      ) : (
        <div className="mt-1 break-words font-bold leading-tight text-white">{value}</div>
      )}
    </div>
  );
}

function PrintableForms({ lead }: { lead: Lead }) {
  return (
    <div className="mt-4 rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-3 flex items-center gap-2 font-display text-lg font-black text-white">
        <FileText className="h-5 w-5 text-mission-gold" />
        Printable Deal Forms
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => openWorksheetPrint(lead.id)} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-mission-gold px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
          <Printer className="h-4 w-4" />
          Customer Worksheet
        </button>
        <a href={georgiaFormsPacketUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-mission-green/40 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-green transition hover:bg-mission-green hover:text-mission-navy">
          <FileText className="h-4 w-4" />
          Open Georgia Packet
        </a>
      </div>
    </div>
  );
}

function defaultDraft(salesperson: string, financeManager: string) {
  return {
    customer: "",
    customerFirstName: "",
    customerMiddleName: "",
    customerLastName: "",
    customerSuffix: "",
    customerAddress: "",
    customerCity: "",
    customerState: "GA",
    customerZip: "",
    customerPhone: "",
    customerEmail: "",
    dlScanText: "",
    creditScore: "",
    employer: "",
    monthlyIncome: "",
    residenceStatus: "",
    source: "Showroom",
    vehicleClass: "New",
    vehicle: "",
    vin: "",
    stockNumber: "",
    vehicleMiles: "0",
    salesperson,
    deskManager: "",
    financeManager,
    creditStatus: "Not Started",
    appointment: "",
    nextAction: "Call / text follow-up",
    notes: "",
    managerNotes: "",
    tradeDetails: "",
    tradeYear: "",
    tradeMake: "",
    tradeModel: "",
    tradeMiles: "0",
    tradePayoffSource: "",
    tradeAcv: "0",
    tradeNotes: "",
    weOwe: "",
    sellingPrice: "35000",
    unitCost: "33000",
    docFee: String(georgiaFees.docFee),
    rebate: "0",
    tradeValue: "0",
    taxCreditEnabled: true,
    payoff: "0",
    cashDown: "1000",
    buyRate: "7.99",
    sellRate: "8.99",
    term: "72",
    showProductsOnWorksheet: false,
    showPaymentSpread: false,
    paymentSpreadStep: "10",
    driversLicense: "",
    dlState: "GA",
    dob: "",
    county: "",
    coBuyerFirstName: "",
    coBuyerMiddleName: "",
    coBuyerLastName: "",
    coBuyerSuffix: "",
    coBuyerPhone: "",
    coBuyerEmail: "",
    coBuyerAddress: "",
    coBuyerCity: "",
    coBuyerState: "GA",
    coBuyerZip: "",
    coBuyerDl: "",
    coBuyerDlState: "GA",
    coBuyerDob: "",
    coBuyerCounty: "",
    vehicleColor: "",
    vehicleBody: "",
    vehicleCylinders: "",
    vehicleFuel: "",
    currentTitle: "",
    lienName: "",
    lienAddress: "",
    insuranceCompany: "",
    insurancePolicy: "",
    insuranceAgentName: "",
    insuranceAgentPhone: "",
    insuranceAgentAddress: "",
    insuranceEffectiveFrom: "",
    insuranceEffectiveTo: "",
    coverageCollision: false,
    coverageComprehensive: false,
    coverageFireTheft: false,
    deductibleCollision: "",
    deductibleComprehensive: "",
    deductibleFireTheft: "",
    vsc: "0",
    gap: "0",
    maintenance: "0",
    permaplate: "0",
    tws: "0",
    utp: "0",
  };
}

function leadToDraft(lead: Lead): ReturnType<typeof defaultDraft> {
  const splitName = splitCustomerName(lead);
  return {
    customer: lead.customer,
    customerFirstName: lead.customerFirstName || splitName.firstName,
    customerMiddleName: lead.customerMiddleName || splitName.middleName,
    customerLastName: lead.customerLastName || splitName.lastName,
    customerSuffix: lead.customerSuffix || splitName.suffix,
    customerAddress: lead.customerAddress,
    customerCity: lead.customerCity,
    customerState: lead.customerState || "GA",
    customerZip: lead.customerZip,
    customerPhone: lead.customerPhone,
    customerEmail: lead.customerEmail,
    dlScanText: "",
    creditScore: lead.creditScore,
    employer: lead.employer,
    monthlyIncome: lead.monthlyIncome,
    residenceStatus: lead.residenceStatus,
    source: lead.source,
    vehicleClass: lead.vehicleClass,
    vehicle: lead.vehicle,
    vin: lead.vin || "",
    stockNumber: lead.stockNumber,
    vehicleMiles: String(lead.vehicleMiles || 0),
    salesperson: lead.salesperson,
    deskManager: lead.deskManager || "",
    financeManager: lead.financeManager,
    creditStatus: lead.creditStatus,
    appointment: lead.appointment,
    nextAction: lead.nextAction,
    notes: lead.notes,
    managerNotes: lead.managerNotes || "",
    tradeDetails: lead.tradeDetails,
    tradeYear: lead.tradeYear,
    tradeMake: lead.tradeMake,
    tradeModel: lead.tradeModel,
    tradeMiles: String(lead.tradeMiles || 0),
    tradePayoffSource: lead.tradePayoffSource,
    tradeAcv: String(lead.tradeAcv || 0),
    tradeNotes: lead.tradeNotes,
    weOwe: lead.weOwe,
    sellingPrice: String(lead.sellingPrice || 0),
    unitCost: String(lead.unitCost || 0),
    docFee: String(lead.docFee ?? georgiaFees.docFee),
    rebate: String(lead.rebate || 0),
    tradeValue: String(lead.tradeValue || 0),
    taxCreditEnabled: lead.taxCreditEnabled,
    payoff: String(lead.payoff || 0),
    cashDown: String(lead.cashDown || 0),
    buyRate: String(lead.buyRate || 0),
    sellRate: String(lead.sellRate || 0),
    term: String(lead.term || 72),
    showProductsOnWorksheet: lead.showProductsOnWorksheet,
    showPaymentSpread: lead.showPaymentSpread,
    paymentSpreadStep: String(lead.paymentSpreadStep || 10),
    driversLicense: lead.driversLicense || "",
    dlState: lead.dlState || "GA",
    dob: lead.dob || "",
    county: lead.county || "",
    coBuyerFirstName: lead.coBuyerFirstName || "",
    coBuyerMiddleName: lead.coBuyerMiddleName || "",
    coBuyerLastName: lead.coBuyerLastName || "",
    coBuyerSuffix: lead.coBuyerSuffix || "",
    coBuyerPhone: lead.coBuyerPhone || "",
    coBuyerEmail: lead.coBuyerEmail || "",
    coBuyerAddress: lead.coBuyerAddress || "",
    coBuyerCity: lead.coBuyerCity || "",
    coBuyerState: lead.coBuyerState || "GA",
    coBuyerZip: lead.coBuyerZip || "",
    coBuyerDl: lead.coBuyerDl || "",
    coBuyerDlState: lead.coBuyerDlState || "GA",
    coBuyerDob: lead.coBuyerDob || "",
    coBuyerCounty: lead.coBuyerCounty || "",
    vehicleColor: lead.vehicleColor || "",
    vehicleBody: lead.vehicleBody || "",
    vehicleCylinders: lead.vehicleCylinders || "",
    vehicleFuel: lead.vehicleFuel || "",
    currentTitle: lead.currentTitle || "",
    lienName: lead.lienName || "",
    lienAddress: lead.lienAddress || "",
    insuranceCompany: lead.insuranceCompany || "",
    insurancePolicy: lead.insurancePolicy || "",
    insuranceAgentName: lead.insuranceAgentName || "",
    insuranceAgentPhone: lead.insuranceAgentPhone || "",
    insuranceAgentAddress: lead.insuranceAgentAddress || "",
    insuranceEffectiveFrom: lead.insuranceEffectiveFrom || "",
    insuranceEffectiveTo: lead.insuranceEffectiveTo || "",
    coverageCollision: lead.coverageCollision,
    coverageComprehensive: lead.coverageComprehensive,
    coverageFireTheft: lead.coverageFireTheft,
    deductibleCollision: lead.deductibleCollision || "",
    deductibleComprehensive: lead.deductibleComprehensive || "",
    deductibleFireTheft: lead.deductibleFireTheft || "",
    vsc: String(lead.products.vsc || 0),
    gap: String(lead.products.gap || 0),
    maintenance: String(lead.products.maintenance || 0),
    permaplate: String(lead.products.permaplate || 0),
    tws: String(lead.products.tws || 0),
    utp: String(lead.products.utp || 0),
  };
}

// Local-day key (YYYY-MM-DD) — "today" means the store's local day, not UTC.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A lead's day: its explicit `date` if set, else the timestamp baked into the
// CRM-<ms> id. Unknown -> null, treated as not-today so a stale/imported lead
// never inflates today's live floor counts.
function leadDayKey(lead: Lead): string | null {
  const raw = (lead as { date?: string }).date;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return dayKey(d);
  }
  const m = /^CRM-(\d{10,})$/.exec(lead.id);
  if (m) {
    const d = new Date(Number(m[1]));
    if (!Number.isNaN(d.getTime())) return dayKey(d);
  }
  return null;
}

function buildLead(draft: ReturnType<typeof defaultDraft>, salespeople: string[], financeManagers: string[]): Lead {
  const customer = buildCustomerName(draft);
  return {
    id: `CRM-${Date.now()}`,
    date: new Date().toISOString(),
    customer,
    customerFirstName: String(draft.customerFirstName || "").trim(),
    customerMiddleName: String(draft.customerMiddleName || "").trim(),
    customerLastName: String(draft.customerLastName || "").trim(),
    customerSuffix: String(draft.customerSuffix || "").trim(),
    customerAddress: String(draft.customerAddress || "").trim(),
    customerCity: String(draft.customerCity || "").trim(),
    customerState: String(draft.customerState || "").trim(),
    customerZip: String(draft.customerZip || "").trim(),
    customerPhone: String(draft.customerPhone || "").trim(),
    customerEmail: String(draft.customerEmail || "").trim(),
    creditScore: String(draft.creditScore || "").trim(),
    employer: String(draft.employer || "").trim(),
    monthlyIncome: String(draft.monthlyIncome || "").trim(),
    residenceStatus: String(draft.residenceStatus || "").trim(),
    source: String(draft.source || ""),
    vehicleClass: draft.vehicleClass === "Used" ? "Used" : draft.vehicleClass === "Lease" ? "Lease" : "New",
    vehicle: String(draft.vehicle || "").trim(),
    vin: String(draft.vin || "").trim().toUpperCase(),
    stockNumber: String(draft.stockNumber || "").trim(),
    vehicleMiles: Number(draft.vehicleMiles) || 0,
    salesperson: String(draft.salesperson || salespeople[0] || ""),
    deskManager: String(draft.deskManager || ""),
    financeManager: String(draft.financeManager || financeManagers[0] || ""),
    creditStatus: creditStatuses.includes(draft.creditStatus as Lead["creditStatus"]) ? (draft.creditStatus as Lead["creditStatus"]) : "Not Started",
    status: draft.appointment ? "Appointment Set" : "New Lead",
    appointment: String(draft.appointment || ""),
    nextAction: String(draft.nextAction || ""),
    notes: String(draft.notes || ""),
    managerNotes: String(draft.managerNotes || ""),
    tradeDetails: String(draft.tradeDetails || ""),
    tradeYear: String(draft.tradeYear || "").trim(),
    tradeMake: String(draft.tradeMake || "").trim(),
    tradeModel: String(draft.tradeModel || "").trim(),
    tradeMiles: Number(draft.tradeMiles) || 0,
    tradePayoffSource: String(draft.tradePayoffSource || "").trim(),
    tradeAcv: Number(draft.tradeAcv) || 0,
    tradeNotes: String(draft.tradeNotes || "").trim(),
    weOwe: String(draft.weOwe || ""),
    sellingPrice: Number(draft.sellingPrice) || 0,
    unitCost: Number(draft.unitCost) || 0,
    docFee: Number(draft.docFee) || 0,
    rebate: Number(draft.rebate) || 0,
    tradeValue: Number(draft.tradeValue) || 0,
    taxCreditEnabled: draft.vehicleClass !== "Lease" && draft.taxCreditEnabled !== false,
    payoff: Number(draft.payoff) || 0,
    cashDown: Number(draft.cashDown) || 0,
    buyRate: Number(draft.buyRate) || 0,
    sellRate: Number(draft.sellRate) || 0,
    rate: Number(draft.sellRate) || 0,
    term: Number(draft.term) || 72,
    showProductsOnWorksheet: Boolean(draft.showProductsOnWorksheet),
    showPaymentSpread: Boolean(draft.showPaymentSpread),
    paymentSpreadStep: draft.paymentSpreadStep === "20" ? 20 : 10,
    driversLicense: String(draft.driversLicense || "").trim().toUpperCase(),
    dlState: String(draft.dlState || "").trim().toUpperCase(),
    dob: String(draft.dob || "").trim(),
    county: String(draft.county || "").trim(),
    coBuyerFirstName: String(draft.coBuyerFirstName || "").trim(),
    coBuyerMiddleName: String(draft.coBuyerMiddleName || "").trim(),
    coBuyerLastName: String(draft.coBuyerLastName || "").trim(),
    coBuyerSuffix: String(draft.coBuyerSuffix || "").trim(),
    coBuyerPhone: String(draft.coBuyerPhone || "").trim(),
    coBuyerEmail: String(draft.coBuyerEmail || "").trim(),
    coBuyerAddress: String(draft.coBuyerAddress || "").trim(),
    coBuyerCity: String(draft.coBuyerCity || "").trim(),
    coBuyerState: String(draft.coBuyerState || "").trim(),
    coBuyerZip: String(draft.coBuyerZip || "").trim(),
    coBuyerDl: String(draft.coBuyerDl || "").trim().toUpperCase(),
    coBuyerDlState: String(draft.coBuyerDlState || "").trim().toUpperCase(),
    coBuyerDob: String(draft.coBuyerDob || "").trim(),
    coBuyerCounty: String(draft.coBuyerCounty || "").trim(),
    vehicleColor: String(draft.vehicleColor || "").trim(),
    vehicleBody: String(draft.vehicleBody || "").trim(),
    vehicleCylinders: String(draft.vehicleCylinders || "").trim(),
    vehicleFuel: String(draft.vehicleFuel || "").trim(),
    currentTitle: String(draft.currentTitle || "").trim(),
    lienName: String(draft.lienName || "").trim(),
    lienAddress: String(draft.lienAddress || "").trim(),
    insuranceCompany: String(draft.insuranceCompany || "").trim(),
    insurancePolicy: String(draft.insurancePolicy || "").trim(),
    insuranceAgentName: String(draft.insuranceAgentName || "").trim(),
    insuranceAgentPhone: String(draft.insuranceAgentPhone || "").trim(),
    insuranceAgentAddress: String(draft.insuranceAgentAddress || "").trim(),
    insuranceEffectiveFrom: String(draft.insuranceEffectiveFrom || "").trim(),
    insuranceEffectiveTo: String(draft.insuranceEffectiveTo || "").trim(),
    coverageCollision: Boolean(draft.coverageCollision),
    coverageComprehensive: Boolean(draft.coverageComprehensive),
    coverageFireTheft: Boolean(draft.coverageFireTheft),
    deductibleCollision: String(draft.deductibleCollision || "").trim(),
    deductibleComprehensive: String(draft.deductibleComprehensive || "").trim(),
    deductibleFireTheft: String(draft.deductibleFireTheft || "").trim(),
    products: {
      vsc: Number(draft.vsc) || 0,
      gap: Number(draft.gap) || 0,
      maintenance: Number(draft.maintenance) || 0,
      permaplate: Number(draft.permaplate) || 0,
      tws: Number(draft.tws) || 0,
      utp: Number(draft.utp) || 0,
    },
  };
}

function buildCustomerName(draft: Pick<ReturnType<typeof defaultDraft>, "customer" | "customerFirstName" | "customerMiddleName" | "customerLastName" | "customerSuffix">) {
  const structured = [draft.customerFirstName, draft.customerMiddleName, draft.customerLastName, draft.customerSuffix]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  return structured || String(draft.customer || "").trim();
}

function buildCoBuyerName(draft: Pick<ReturnType<typeof defaultDraft>, "coBuyerFirstName" | "coBuyerMiddleName" | "coBuyerLastName" | "coBuyerSuffix">) {
  return [draft.coBuyerFirstName, draft.coBuyerMiddleName, draft.coBuyerLastName, draft.coBuyerSuffix]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
}

function splitCustomerName(lead: Pick<Lead, "customer">) {
  const parts = String(lead.customer || "").trim().split(/\s+/).filter(Boolean);
  const suffix = parts.length && suffixOptions.includes(parts[parts.length - 1]) ? parts.pop() || "" : "";
  const firstName = parts.shift() || "";
  const lastName = parts.pop() || "";
  const middleName = parts.join(" ");
  return { firstName, middleName, lastName, suffix };
}

const inputClass = "h-11 w-full rounded-[12px] border border-white/10 bg-[#14161c]/80 px-3 text-sm text-white outline-none transition placeholder:text-white/28 focus:border-mission-gold/60";
