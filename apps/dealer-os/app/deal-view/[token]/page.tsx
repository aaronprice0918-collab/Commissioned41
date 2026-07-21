"use client";

import { useParams } from "next/navigation";
import { YourDealView } from "@/components/YourDealView";

// Legacy path-based share link (/deal-view/<token>) — kept working for links
// already texted to customers. New links use the fragment form (/deal-view#<token>,
// served by ../page.tsx) so the secret never rides in the URL path (SOC 2 M-9).
export default function YourDealLegacyPage() {
  const { token } = useParams<{ token: string }>();
  return <YourDealView pathToken={token} />;
}
