import Link from "next/link";
import { MissionMark } from "@/components/Brand";

// Branded 404 — unknown routes used to fall through to Next's bare default
// page: unstyled, off-brand, and with no way back into the app (July 8 audit).
export default function NotFound() {
  return (
    <div className="grid min-h-[100dvh] place-items-center px-6 text-center">
      <div>
        <MissionMark width={72} className="mx-auto" />
        <h1 className="mt-6 font-display text-2xl font-black">That page isn&apos;t here.</h1>
        <p className="mx-auto mt-2 max-w-[32ch] text-sm text-fg/60">
          The link may be old or mistyped. Your numbers are safe — they&apos;re all on Home.
        </p>
        <Link href="/" className="btn btn-primary mt-6 inline-flex px-8">Back Home</Link>
      </div>
    </div>
  );
}
