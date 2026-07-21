import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { NAV_LINKS, PRODUCT_LIST, BRAND } from "@/config/site";

// Shared footer. Restates the brand, links the ecosystem, and routes out to the
// two products.
export function Footer() {
  return (
    <footer className="mt-12 border-t border-white/5">
      <div className="mx-auto grid max-w-shell gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark className="text-xl" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
            Operating systems for people and businesses who refuse to drift.
          </p>
          <p className="mt-4 text-xs text-white/60">{BRAND.tagline}</p>
        </div>

        <div>
          <p className="eyebrow mb-4">Company</p>
          <ul className="space-y-2.5 text-sm">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-white/50 transition-colors hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="eyebrow mb-4">Products</p>
          <ul className="space-y-2.5 text-sm">
            {PRODUCT_LIST.map((p) => (
              <li key={p.key}>
                <a
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/50 transition-colors hover:text-white"
                >
                  {p.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-white/5">
        <div className="mx-auto flex max-w-shell flex-col items-center justify-between gap-3 px-5 py-6 text-xs text-white/60 sm:flex-row sm:px-8">
          <p>© {new Date().getFullYear()} {BRAND.name}. All rights reserved.</p>
          <p>{BRAND.domain}</p>
        </div>
      </div>
    </footer>
  );
}
