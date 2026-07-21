"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useCrmLeads } from "@/components/CrmProvider";
import { Sheet } from "@/components/DealWorksheet";
import { calculateDesk } from "@/lib/desk";

function PrintWorksheetInner() {
  const params = useSearchParams();
  const leadId = params.get("lead") || "";
  const { leads } = useCrmLeads();
  const lead = useMemo(() => leads.find((l) => l.id === leadId), [leads, leadId]);

  const desk = useMemo(() => (lead ? calculateDesk(lead) : null), [lead]);
  const zeroDownAmount = lead && desk ? desk.amountFinanced + lead.cashDown : 0;
  const seedDown = lead && lead.cashDown > 0 ? lead.cashDown : 2000;
  const terms = [60, 72, 84];
  const downs = [seedDown, seedDown + 2000, seedDown + 5000];

  useEffect(() => {
    if (!lead) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [lead]);

  if (!lead) {
    return (
      <div style={{ padding: 48, fontFamily: "Arial, sans-serif", color: "#111", fontSize: 14 }}>
        Loading worksheet…
      </div>
    );
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        @media print {
          @page { size: letter; margin: 0.45in; }
          html, body { background: #ffffff !important; }
        }
      `}</style>
      <Sheet
        lead={lead}
        terms={terms}
        downs={downs}
        zeroDownAmount={zeroDownAmount}
        rate={lead.rate}
        editable={false}
      />
    </>
  );
}

export default function PrintWorksheetPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 48, fontFamily: "Arial, sans-serif", color: "#111", fontSize: 14 }}>
          Loading worksheet…
        </div>
      }
    >
      <PrintWorksheetInner />
    </Suspense>
  );
}
