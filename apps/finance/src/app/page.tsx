import { loadProfile } from "@/lib/profile";
import { gateActive } from "@/lib/session";
import { Dashboard } from "@/components/Dashboard";

// Always render fresh — balances change, and router.refresh() after a sync
// should reflect immediately.
export const dynamic = "force-dynamic";

export default async function Page() {
  const { profile, isLive } = await loadProfile();
  return <Dashboard profile={profile} isLive={isLive} locked={gateActive()} />;
}
