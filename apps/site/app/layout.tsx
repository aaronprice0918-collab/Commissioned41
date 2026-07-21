import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AmbientField } from "@/components/AmbientField";
import { ScrollProgress } from "@/components/ScrollProgress";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { BRAND, MISSION_STATEMENT } from "@/config/site";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://commissioned41.com"),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s — ${BRAND.name}`,
  },
  description: MISSION_STATEMENT,
  keywords: [
    "Commissioned 41",
    "Mission OS",
    "EILA",
    "Dealer Mission OS",
    "operating system",
    "commission sales",
    "dealership software",
  ],
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: MISSION_STATEMENT,
    type: "website",
    url: "https://commissioned41.com",
    siteName: BRAND.name,
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: MISSION_STATEMENT,
  },
};

export const viewport: Viewport = {
  themeColor: "#f0f4fb",
  width: "device-width",
  initialScale: 1,
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: BRAND.name,
  url: "https://commissioned41.com",
  description: MISSION_STATEMENT,
  logo: "https://commissioned41.com/brand/c41-logo-transparent.png",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <script
          type="application/ld+json"
          // JSON-LD Organization schema for the brand entity.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <AmbientField />
        <ScrollProgress />
        <Nav />
        <main className="relative overflow-hidden">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
