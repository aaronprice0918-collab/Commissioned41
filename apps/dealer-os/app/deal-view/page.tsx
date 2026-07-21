"use client";

import { YourDealView } from "@/components/YourDealView";

// Current customer share link: /deal-view#<token>. The token lives in the URL
// FRAGMENT, which browsers never send in the Referer header or to servers/proxies,
// so the capability secret doesn't leak through logs or third-party assets
// (SOC 2 audit M-9). The view reads the fragment client-side.
export default function YourDealPage() {
  return <YourDealView />;
}
