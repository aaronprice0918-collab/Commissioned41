"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Car, CheckCircle2, ClipboardList, Phone } from "lucide-react";
import type { YourDealPayload } from "@/lib/yourDeal";

// "Your Deal" — the public, customer-facing view behind the share link. No login,
// no app: the customer opens it on their phone and sees THEIR deal. Shared by two
// routes: /deal-view#<token> (current — the secret rides in the URL FRAGMENT, which
// browsers never send in the Referer header, browser history sync, or server/proxy
// logs — SOC 2 audit M-9) and /deal-view/<token> (legacy path links already texted
// to customers, kept working). Pass `pathToken` for the legacy route; otherwise the
// token is read from the fragment.
export function YourDealView({ pathToken }: { pathToken?: string }) {
  const [deal, setDeal] = useState<YourDealPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone">("loading");

  useEffect(() => {
    // Fragment first (current links), path param second (legacy links).
    const fromHash = typeof window !== "undefined" ? window.location.hash.replace(/^#(?:token=)?/, "") : "";
    const token = (pathToken || fromHash || "").trim();
    if (!token) {
      setState("gone");
      return;
    }
    fetch(`/api/your-deal?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setDeal(await r.json());
        setState("ready");
      })
      .catch(() => setState("gone"));
  }, [pathToken]);

  return (
    <main
      className="min-h-screen px-5 py-10"
      style={{ ["--c41-white" as string]: "255 255 255", background: "linear-gradient(180deg,#eef3fb,#e7eefb 45%,#dde8fa)", color: "#16202e" }}
    >
      <div className="mx-auto w-full max-w-md">
        {state === "loading" && <div className="pt-24 text-center text-sm font-bold uppercase tracking-[0.16em] text-slate-400">Loading your deal…</div>}

        {state === "gone" && (
          <div className="rounded-3xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-900/5">
            <div className="font-black text-xl text-slate-800">This link has expired.</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">Ask your salesperson to send you a fresh one — it takes them one tap.</p>
          </div>
        )}

        {state === "ready" && deal && (
          <>
            <div className="text-center">
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{deal.storeName}</div>
              <h1 className="mt-1 font-black text-3xl leading-tight text-slate-900">
                {deal.customerFirstName ? `${deal.customerFirstName}, here's your deal.` : "Here's your deal."}
              </h1>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-600/15">
                <CheckCircle2 className="h-3.5 w-3.5" /> {deal.status}
              </div>
            </div>

            <div className="mt-6 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-900/5">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-white"><Car className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <div className="truncate font-black text-lg text-slate-900">{deal.vehicle}</div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{[deal.vehicleClass, deal.stockNumber && `Stock ${deal.stockNumber}`].filter(Boolean).join(" · ")}</div>
                </div>
              </div>

              {deal.payment !== null && (
                <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-center ring-1 ring-slate-900/5">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Your estimated payment</div>
                  <div className="mt-1 font-black text-4xl text-slate-900" style={{ fontVariantNumeric: "tabular-nums" }}>
                    ${deal.payment.toLocaleString()}<span className="text-base font-bold text-slate-400">/mo</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {deal.term} months{deal.cashDown ? ` · $${deal.cashDown.toLocaleString()} down` : ""} · plus final taxes &amp; fees at signing
                  </div>
                </div>
              )}

              {deal.appointment && (
                <div className="mt-4 flex items-center gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-600/15">
                  <CalendarClock className="h-4 w-4 shrink-0" />
                  Your visit: {new Date(deal.appointment).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
              )}
            </div>

            <div className="mt-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-900/5">
              <div className="flex items-center gap-2 font-black text-slate-900"><ClipboardList className="h-4 w-4 text-slate-400" /> What to bring</div>
              <ul className="mt-3 space-y-2">
                {deal.docsToBring.map((doc) => (
                  <li key={doc} className="flex items-start gap-2.5 text-sm leading-5 text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {doc}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-slate-900/5">
              <div className="font-black text-slate-900">What happens next</div>
              <ol className="mt-3 space-y-2">
                {deal.nextSteps.map((step, i) => (
                  <li key={step} className="flex items-start gap-2.5 text-sm leading-5 text-slate-600">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-900 text-[10px] font-black text-white">{i + 1}</span> {step}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-6 text-center text-xs text-slate-400">
              <div className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> Questions? Your salesperson {deal.salesperson} has you covered.</div>
              <div className="mt-2">Numbers are estimates until final paperwork · {deal.storeName}</div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
