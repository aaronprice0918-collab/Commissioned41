"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, MessageSquareText, Send, ShieldOff, Sparkles, X } from "lucide-react";
import { type CrmLead } from "@/components/CrmProvider";
import { useAuth } from "@/components/AuthProvider";
import { useStoreSettings } from "@/components/StoreSettingsProvider";
import { consentStatus } from "@/lib/consent";
import { type LeadMessage } from "@/lib/comms";
import { firstTouchDraft } from "@/lib/firstTouch";
import { authHeaders } from "@/lib/storeClient";

// The text thread with one customer — the comms hub's face. Bubbles for the
// conversation (server-written; this screen just renders and asks the server
// to send). The composer only exists when text consent is GRANTED — the
// consent rail isn't a warning here, it's the door.
export function TextThread({
  lead,
  onClose,
  onSent,
}: {
  lead: CrmLead;
  onClose: () => void;
  onSent: (message: LeadMessage) => void;
}) {
  const { profile } = useAuth();
  const { settings } = useStoreSettings();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [drafted, setDrafted] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const consent = consentStatus(lead, "text");
  const thread = lead.messages ?? [];
  const isFirstTouch = thread.every((m) => m.dir !== "out");

  useEffect(() => {
    fetch("/api/sms/send")
      .then((r) => r.json())
      .then((d) => setConfigured(Boolean(d?.configured)))
      .catch(() => setConfigured(false));
  }, []);

  // The first-touch draft: EILA has it written before the rep can think about
  // it. The deterministic template lands INSTANTLY (no round-trip, works with
  // the AI off); her live personalized draft replaces it when it arrives —
  // unless the rep already started editing, in which case their words win.
  useEffect(() => {
    if (!isFirstTouch || drafted) return;
    setDrafted(true);
    const template = firstTouchDraft(lead, profile?.displayName || lead.salesperson || "", settings.storeName || "");
    setDraft((current) => current || template);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/crm", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ action: "draft-followup", lead: { id: lead.id }, channel: "text", firstTouch: true }),
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const upgraded = String(data?.draft || "").trim();
        if (!cancelled && upgraded) {
          setDraft((current) => (current === template ? upgraded : current));
        }
      } catch {
        // Template stays — the draft never blocks on the AI.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstTouch, drafted]);

  function copyDraft() {
    void navigator.clipboard.writeText(draft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread.length]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ leadId: lead.id, body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(String(data?.error || "Couldn't send — try again."));
      } else if (data?.message) {
        onSent(data.message as LeadMessage);
        setDraft("");
      }
    } catch {
      setError("Couldn't send — check the connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-panel relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-[20px] sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5 pb-3">
          <div>
            <div className="flex items-center gap-2 font-display text-xl font-black text-white">
              <MessageSquareText className="h-5 w-5 text-mission-gold" /> {lead.customer || "Text thread"}
            </div>
            <div className="mt-0.5 text-xs text-white/50">{lead.customerPhone || "No phone on file"}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/12 text-white/60 transition hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-[180px] flex-1 space-y-2 overflow-y-auto p-5">
          {thread.length === 0 && <div className="pt-8 text-center text-sm text-white/40">No texts with {lead.customerFirstName || "this customer"} yet.</div>}
          {thread.map((m, i) => (
            <div key={m.sid || i} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-[14px] px-3.5 py-2 text-sm leading-5 ${m.dir === "out" ? "bg-mission-gold/90 text-mission-navy" : "border border-white/10 bg-white/[0.06] text-white/85"}`}>
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className={`mt-1 text-[10px] font-bold uppercase tracking-[0.08em] ${m.dir === "out" ? "text-mission-navy/60" : "text-white/35"}`}>
                  {m.dir === "out" ? m.by || "Sent" : "Customer"} · {new Date(m.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 p-4">
          {consent === "revoked" ? (
            <div className="flex items-center gap-2 rounded-[12px] border border-mission-red/50 bg-mission-red/10 p-3 text-sm font-bold text-mission-red">
              <ShieldOff className="h-4 w-4 shrink-0" /> This customer revoked text consent — do not text them.
            </div>
          ) : consent !== "granted" ? (
            <div className="rounded-[12px] border border-mission-gold/40 bg-mission-gold/[0.07] p-3 text-sm leading-5 text-mission-gold">
              No text consent on file. Capture it on the lead card first (tap the <span className="font-black">Text</span> consent chip) — then this composer opens.
            </div>
          ) : configured === false ? (
            <div className="space-y-2">
              {draft && (
                <div className="rounded-[12px] border border-mission-gold/30 bg-mission-gold/[0.06] p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-mission-gold">
                    <Sparkles className="h-3 w-3" /> EILA drafted your first touch
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-5 text-white/85">{draft}</p>
                  <button type="button" onClick={copyDraft} className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-mission-gold/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-mission-gold transition hover:bg-mission-gold hover:text-mission-navy">
                    <Copy className="h-3 w-3" /> {copied ? "Copied!" : "Copy — send from your phone"}
                  </button>
                </div>
              )}
              <div className="rounded-[12px] border border-white/12 bg-white/[0.04] p-3 text-sm leading-5 text-white/55">
                Texting isn&apos;t connected yet — the thread will light up when the store&apos;s texting number is set up.
              </div>
            </div>
          ) : (
            <div>
              {isFirstTouch && draft && (
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-mission-gold">
                  <Sparkles className="h-3 w-3" /> EILA drafted your first touch — edit anything, then send
                </div>
              )}
              <form onSubmit={send} className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Text ${lead.customerFirstName || "the customer"}…`}
                  rows={isFirstTouch && draft ? 3 : 2}
                  className="min-h-[44px] flex-1 resize-none rounded-[12px] border border-white/12 bg-[#14161c]/80 p-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-mission-gold/60"
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-mission-gold text-mission-navy shadow-gold transition hover:brightness-110 disabled:opacity-40"
                  aria-label="Send text"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          )}
          {error && <p className="mt-2 text-sm font-bold text-mission-red">{error}</p>}
          {consent === "granted" && thread.every((m) => m.dir !== "out") && (
            <p className="mt-2 text-[11px] leading-4 text-white/35">First text automatically includes “{`Reply STOP to opt out.`}”</p>
          )}
        </div>
      </div>
    </div>
  );
}
