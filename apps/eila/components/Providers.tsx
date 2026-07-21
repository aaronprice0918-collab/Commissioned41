"use client";

import { MissionProvider } from "@/lib/store";
import { VersionGuard } from "./VersionGuard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MissionProvider>
      <VersionGuard />
      {children}
    </MissionProvider>
  );
}
