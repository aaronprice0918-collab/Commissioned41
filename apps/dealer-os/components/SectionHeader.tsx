import type { LucideIcon } from "lucide-react";

export function SectionHeader({ title, kicker, icon: Icon }: { title: string; kicker?: string; icon?: LucideIcon }) {
  return (
    <div className="mb-6">
      {kicker && <div className="readable-text text-[11px] font-semibold uppercase tracking-[0.22em] text-mission-gold/80">{kicker}</div>}
      <div className="mt-1.5 flex items-center gap-3">
        {Icon && (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-mission-gold/10 text-mission-gold">
            <Icon className="h-6 w-6" />
          </span>
        )}
        <h1 className="readable-text font-display text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">{title}</h1>
      </div>
    </div>
  );
}
