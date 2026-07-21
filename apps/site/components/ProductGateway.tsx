import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { BRAND_ASSETS, type Product } from "@/config/site";

// The giant premium "launch button" for a product. Not a nav tab — a full-width
// gateway card that opens the product property in a new tab. Reused on the home
// page and the /products page.
//
// Brand system: EILA carries the navy/blue/teal motion mark. Dealer Mission OS
// carries the machined M mark. Commissioned 41 is the C41 logo elsewhere.
const PRODUCT_MARK: Record<Product["key"], { src: string; alt: string; glow: string; shadow: string }> = {
  lite: {
    src: BRAND_ASSETS.eilaIcon,
    alt: "EILA",
    glow: "bg-mission-gold/20",
    shadow: "drop-shadow-[0_14px_30px_rgba(7,27,57,0.44)]",
  },
  dealer: {
    src: BRAND_ASSETS.dealerMark,
    alt: "Dealer Mission OS",
    glow: "bg-mission-green/16",
    shadow: "drop-shadow-[0_16px_30px_rgba(15,23,42,0.34)]",
  },
};

export function ProductGateway({ product }: { product: Product }) {
  const mark = PRODUCT_MARK[product.key];
  const comingSoon = product.status === "comingSoon";

  // Coming-soon products don't get a live link out to the app. Dealer's
  // self-serve signup is switched off, so route interested visitors to Contact.
  const linkProps = comingSoon
    ? { href: "/contact" }
    : { href: product.href, target: "_blank", rel: "noopener noreferrer" };

  return (
    <a
      {...linkProps}
      aria-label={comingSoon ? `${product.name} — coming soon, get in touch` : `${product.cta} (opens in a new tab)`}
      className="group block h-full"
    >
      <div
        className={`glass living-border relative flex h-full flex-col overflow-hidden p-7 transition-transform duration-500 group-hover:-translate-y-1.5 sm:p-9 ${comingSoon ? "opacity-90" : ""}`}
      >
        {comingSoon && (
          <span className="absolute right-5 top-5 rounded-full border border-white/12 bg-white/[0.05] px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/60">
            Coming Soon
          </span>
        )}
        {/* top: mark + label */}
        <div className="flex items-center gap-5">
          <div className="relative grid h-20 w-20 shrink-0 place-items-center sm:h-24 sm:w-24">
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-full blur-2xl ${mark.glow}`}
            />
            <Image
              src={mark.src}
              alt={mark.alt}
              width={868}
              height={868}
              unoptimized
              className={`relative h-[70px] w-[70px] select-none object-contain ${product.key === "lite" ? "rounded-[22%]" : ""} ${mark.shadow} sm:h-[84px] sm:w-[84px]`}
            />
          </div>
          {/* min-w-0 lets the title column shrink so long product names wrap
              rather than being clipped by overflow-hidden. */}
          <div className="min-w-0">
            <h3 className="text-2xl font-black leading-[1.06] tracking-tight text-white sm:text-[1.7rem]">
              {product.name}
            </h3>
            <p className="mt-1 text-sm leading-snug text-mission-gold/90">{product.audience}</p>
          </div>
        </div>

        {/* subtitle */}
        <p className="mt-6 text-[15px] font-medium leading-relaxed text-white/80">
          {product.subtitle}
        </p>
        {/* description */}
        <p className="mt-3 text-[15px] leading-relaxed text-white/55">{product.description}</p>

        {/* feature chips */}
        <div className="mt-6 flex flex-wrap gap-2">
          {product.features.map((f) => (
            <span
              key={f}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60"
            >
              {f}
            </span>
          ))}
        </div>

        {/* the launch button */}
        <div className="mt-8 flex-1" />
        <div className={comingSoon ? "btn btn-ghost w-full" : "btn btn-primary w-full"}>
          {comingSoon ? "Get Notified" : product.cta}
          <ArrowRight size={17} className="transition-transform duration-300 group-hover:translate-x-1" />
        </div>
      </div>
    </a>
  );
}
