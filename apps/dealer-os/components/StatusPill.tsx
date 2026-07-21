import clsx from "clsx";

const styles = {
  green: "border-mission-green/30 bg-mission-green/10 text-mission-green",
  gold: "border-mission-gold/35 bg-mission-gold/10 text-mission-gold",
  amber: "border-white/20 bg-white/[0.08] text-white/85",
  red: "border-mission-red/35 bg-mission-red/10 text-mission-red",
  blue: "border-white/15 bg-white/[0.06] text-white/72",
};

export function StatusPill({ children, tone = "blue" }: { children: React.ReactNode; tone?: keyof typeof styles }) {
  return (
    <span className={clsx("readable-text inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-left text-[10px] font-bold uppercase leading-5 tracking-[0.12em]", styles[tone])}>
      {children}
    </span>
  );
}
