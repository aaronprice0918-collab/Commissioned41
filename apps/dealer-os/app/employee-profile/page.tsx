"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Employee Profile and My Scorecard are one and the same — a single private
// personal page (your stats, your pace, your expected pay). This route now
// redirects to it so there's only one place to go.
export default function EmployeeProfileRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/my-scorecard");
  }, [router]);
  return <div className="p-8 text-sm text-white/56">Opening your scorecard…</div>;
}
