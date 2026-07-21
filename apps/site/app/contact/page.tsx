import type { Metadata } from "next";
import Image from "next/image";
import { Mail } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import { PageHeader } from "@/components/Section";
import { ContactForm } from "@/components/ContactForm";
import { BRAND_ASSETS, PRODUCTS } from "@/config/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with Commissioned 41 — questions about EILA, Dealer Mission OS, or the company.",
};

export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Contact"
        title={
          <>
            Let&apos;s talk about{" "}
            <span className="chrome-text">your mission.</span>
          </>
        }
        intro="Whether you're here for EILA, Dealer Mission OS, or a broader Commissioned 41 conversation, send a note and we'll get back to you."
      />

      <section className="mx-auto max-w-shell px-5 pb-24 pt-10 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          {/* left rail */}
          <Reveal>
            <div className="space-y-4">
              <div className="glass flex items-center gap-4 p-6">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-mission-green/10 text-mission-green">
                  <Mail size={20} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">General inquiries</p>
                  <p className="mt-0.5 text-sm text-white/50">We read every message.</p>
                </div>
              </div>

              <a
                href={PRODUCTS.lite.href}
                target="_blank"
                rel="noopener noreferrer"
                className="glass glass-hover flex items-center gap-4 p-6"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-mission-green/10">
                  <Image src={BRAND_ASSETS.eilaIcon} alt="" width={868} height={868} unoptimized className="h-8 w-8 rounded-lg object-contain shadow-[0_8px_20px_rgba(7,27,57,0.38)]" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">EILA</p>
                  <p className="mt-0.5 text-sm text-white/50">{PRODUCTS.lite.audience}</p>
                </div>
              </a>

              <a
                href={PRODUCTS.dealer.href}
                target="_blank"
                rel="noopener noreferrer"
                className="glass glass-hover flex items-center gap-4 p-6"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-mission-green/10 text-mission-green">
                  <Image src={BRAND_ASSETS.dealerMark} alt="" width={38} height={38} unoptimized className="h-9 w-9 object-contain" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">Dealer Mission OS</p>
                  <p className="mt-0.5 text-sm text-white/50">{PRODUCTS.dealer.audience}</p>
                </div>
              </a>
            </div>
          </Reveal>

          {/* form */}
          <Reveal delay={100}>
            <ContactForm />
          </Reveal>
        </div>
      </section>
    </>
  );
}
