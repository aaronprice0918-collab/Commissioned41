"use client";

import { useState } from "react";
import { FileText, Check, ChevronRight, Sparkles, AlertTriangle } from "lucide-react";
import { useMission, defaultPlan } from "@/lib/store";
import { Industry, INDUSTRY_LABEL, INDUSTRY_UNIT, Role, ROLE_LABEL } from "@/lib/types";
import { PayPlan } from "@/lib/payplan/types";
import { Wordmark } from "./AppShell";
import { Labeled } from "./ui";
import { PlanEditor } from "./PlanEditor";
import { PayPlanUploader, ParseResult } from "./PayPlanUploader";
import { PayPlanReview } from "./PayPlanReview";

const INDUSTRIES: Industry[] = [
  "automotive", "real_estate", "mortgage", "insurance", "furniture", "jewelry",
  "rv_boats_powersports", "solar_roofing", "recruiting", "saas", "financial_services", "other",
];

const ROLES: Role[] = ["sales", "finance", "sales_manager", "bdc"];
const ROLE_BLURB: Record<Role, string> = {
  sales: "You close the sale. Paid on what you sell, plus bonuses.",
  finance: "You handle structuring, financing, or add-ons. Paid on margin and attach rate.",
  sales_manager: "You oversee a team's production. Paid on total volume and overrides.",
  bdc: "You're paid on activity — appointments set, leads converted.",
};

export function Onboarding() {
  const { setProfile } = useMission();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState<Industry | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [plan, setPlan] = useState<PayPlan | null>(null);
  const [fileName, setFileName] = useState<string>();
  const [parseStatus, setParseStatus] = useState<"ok" | "fallback" | null>(null);

  function chooseIndustry(i: Industry) { setIndustry(i); setStep(2); }
  function chooseRole(r: Role) { setRole(r); setPlan(defaultPlan(r)); setStep(3); }

  function onParsed(r: ParseResult) {
    if (!role) return;
    setFileName(r.sourceName);
    if (r.ok && r.plan) { setPlan(r.plan); setParseStatus("ok"); }
    else { setPlan(defaultPlan(role)); setParseStatus("fallback"); }
    setStep(4);
  }

  function finish() { if (role && plan && industry) setProfile(name.trim() || "Rep", role, industry, plan, fileName); }
  const unit = INDUSTRY_UNIT[industry ?? "automotive"];

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-app px-5 py-8">
      <div className="mb-8 flex flex-col items-center text-center">
        <Wordmark height={34} />
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-fg/50">Your AI assistant for commission, money, and daily execution. Bring EILA the messy day — she&apos;ll help you see what matters and choose the next move.</p>
      </div>

      {step === 0 && (
        <div className="rise space-y-5">
          <Labeled label="What's your name?">
            <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" onKeyDown={(e) => e.key === "Enter" && setStep(1)} />
          </Labeled>
          <button className="btn btn-primary btn-block" onClick={() => setStep(1)}>Continue <ChevronRight size={16} /></button>
        </div>
      )}

      {step === 1 && (
        <div className="rise space-y-3">
          <h2 className="px-1 text-lg font-bold">What industry are you in?</h2>
          <p className="px-1 text-sm text-fg/50">EILA adapts the language, examples, and coaching to your world.</p>
          <div className="grid grid-cols-2 gap-2">
            {INDUSTRIES.map((i) => (
              <button key={i} onClick={() => chooseIndustry(i)} className="glass glass-tap p-4 text-left font-semibold">
                {INDUSTRY_LABEL[i]}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="rise space-y-3">
          <h2 className="px-1 text-lg font-bold">What's your role?</h2>
          {ROLES.map((r) => (
            <button key={r} onClick={() => chooseRole(r)} className="glass glass-tap flex w-full items-center justify-between p-4 text-left">
              <div><div className="font-bold">{ROLE_LABEL[r]}</div><div className="text-xs text-fg/70">{ROLE_BLURB[r]}</div></div>
              <ChevronRight size={18} className="text-fg/65" />
            </button>
          ))}
        </div>
      )}

      {step === 3 && role && (
        <div className="rise space-y-4">
          <h2 className="px-1 text-lg font-bold">Add your pay plan</h2>
          <p className="px-1 text-sm text-fg/50">Upload it and we&apos;ll read it for you — snap a photo of each page, or use a PDF or text file. Flat, tiered, or grid: we&apos;ll pull the structure automatically.</p>
          <PayPlanUploader role={role} industry={industry} onResult={onParsed} />
          <button className="btn btn-ghost btn-block" onClick={() => { setPlan(defaultPlan(role)); setStep(4); }}>I&apos;ll set it up manually</button>
        </div>
      )}

      {step === 4 && plan && (
        <div className="rise space-y-4">
          <div className="flex items-center gap-2 px-1"><Sparkles size={16} className="text-accent2" /><h2 className="text-lg font-bold">Your pay plan</h2></div>
          {fileName && (
            <div className="glass flex items-start gap-2 p-3 text-sm text-fg/60"><FileText size={16} className="mt-0.5 shrink-0 text-accent" /><span className="min-w-0 break-words">{fileName}</span></div>
          )}
          {parseStatus === "ok" && (
            <div className="flex items-start gap-2 rounded-xl bg-good/10 p-3 text-sm text-good"><Check size={16} className="mt-0.5 shrink-0" /><span>Read your pay plan and classified it. Confirm the numbers below.</span></div>
          )}
          {parseStatus === "fallback" && (
            <div className="flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>We couldn&apos;t read that one automatically. Here&apos;s a typical {role ? ROLE_LABEL[role] : "rep"} starting point — tweak it, or go back and upload a clearer PDF or a photo of the page.</span></div>
          )}
          <PayPlanReview plan={plan} industry={industry ?? "other"} />
          <PlanEditor plan={plan} onChange={setPlan} unit={unit} industry={industry ?? "other"} />
          <button className="btn btn-primary btn-block" onClick={finish}><Check size={16} /> Start With EILA</button>
        </div>
      )}

      {/* Back on EVERY step past the first — the step-4 fallback banner says
          "go back and upload a clearer PDF", and there was no way back. */}
      {step > 0 && <button className="mx-auto mt-6 block text-sm text-fg/65" onClick={() => setStep((s) => s - 1)}>Back</button>}
    </div>
  );
}
