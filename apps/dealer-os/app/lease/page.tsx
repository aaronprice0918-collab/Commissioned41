"use client";

import { SectionHeader } from "@/components/SectionHeader";
import { LeaseDesk } from "@/components/LeaseDesk";
import { useAuth } from "@/components/AuthProvider";

export default function LeasePage() {
  const { isOwner, isAdmin, isManager, profile } = useAuth();
  const canUse = isOwner || isAdmin || isManager || profile?.role === "F&I";

  return (
    <div>
      <SectionHeader title="Georgia Lease" kicker="Money factor + residual → payment, taxed the Georgia way" />
      {canUse ? (
        <LeaseDesk />
      ) : (
        <div className="glass-panel rounded-[12px] p-6 text-white/70">This screen is for managers and F&amp;I.</div>
      )}
    </div>
  );
}
