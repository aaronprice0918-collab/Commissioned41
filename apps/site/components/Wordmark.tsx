import Image from "next/image";
import clsx from "clsx";

// The Commissioned 41 wordmark — echoes the locked MISSION/OS chrome treatment:
// chrome/platinum "COMMISSIONED" + a steel-blue "41" that glows. Size and tracking
// come from the parent via className.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("font-display font-black leading-none tracking-tight", className)} aria-label="Commissioned 41">
      <span className="chrome-text">COMMISSIONED&nbsp;</span>
      <span className="steel-text">41</span>
    </span>
  );
}

// Compact lockup for the nav: a steel-blue "41" badge + chrome wordmark.
export function NavMark({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5 font-display font-black", className)} aria-label="Commissioned 41">
      <span className="relative grid h-9 w-9 place-items-center">
        <Image
          src="/brand/c41-mono-transparent.png"
          alt="Commissioned 41"
          width={691}
          height={554}
          className="chrome-art h-full w-full select-none object-contain"
        />
      </span>
      <span className="hidden text-[15px] tracking-tight sm:inline">
        <span className="chrome-text">COMMISSIONED</span>
      </span>
    </span>
  );
}
