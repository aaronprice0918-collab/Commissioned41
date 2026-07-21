import type { Metadata } from "next";
import { GuideBody } from "./GuideBody";

export const metadata: Metadata = {
  title: "Get EILA on Your Phone — Kennesaw Mazda",
  description: "Step-by-step: install EILA on iPhone or Android, first-time setup, and what to ask her.",
};

// A permanent, public, no-login page — the link Aaron hands his team (via
// WhatsApp, text, whatever). Lives on the app's own domain so it never
// depends on any third-party sharing toggle.
export default function GuidePage() {
  return <GuideBody />;
}
