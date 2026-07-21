import clsx from "clsx";
import Image from "next/image";

const LOGO_RATIO = 1;

export function MissionMark({ className, width = 72 }: { className?: string; width?: number }) {
  return (
    <div className={clsx("flex flex-col items-center", className)} aria-label="EILA" role="img">
      <Image
        src="/brand/eila-app-icon.png"
        alt="EILA"
        width={868}
        height={868}
        priority
        className="h-auto select-none rounded-[22%] object-contain drop-shadow-[0_12px_26px_rgba(7,27,57,0.24)]"
        style={{ width }}
      />
    </div>
  );
}

export function Wordmark({ className, height = 24 }: { className?: string; height?: number }) {
  return (
    <div
      className={clsx("inline-flex select-none items-center gap-2", className)}
      style={{ height }}
      role="img"
      aria-label="EILA"
    >
      <Image
        src="/brand/eila-app-icon.png"
        alt=""
        width={868}
        height={868}
        priority
        className="h-full w-auto rounded-[22%] object-contain"
        style={{ width: height * LOGO_RATIO }}
      />
      <span
        className="font-black text-[#071B39]"
        style={{ fontSize: Math.max(14, height * 0.86), lineHeight: `${height}px`, letterSpacing: "0.12em" }}
      >
        EILA
      </span>
    </div>
  );
}
