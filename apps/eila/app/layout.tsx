import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "EILA",
  description:
    "Your AI assistant for commission, money, and daily execution. Know where you stand, what needs attention, and the next best move.",
  manifest: "/manifest.webmanifest",
  // Explicit icon links. These point at static PNG files made from Aaron's
  // exact logo image, not generated/vectorized routes.
  icons: {
    icon: [
      { url: "/icon.png?v=7", type: "image/png", sizes: "1024x1024" },
      { url: "/icon.svg?v=7", type: "image/svg+xml" },
    ],
    // ?v=7 busts iOS's home-screen icon cache — Safari can keep serving a stale
    // icon for the SAME url even after remove + re-add. Bump v when icon art changes.
    apple: [{ url: "/apple-icon.png?v=7", type: "image/png", sizes: "180x180" }],
  },
  // "default" = dark status-bar text on the app's light theme.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "EILA" },
};

export const viewport: Viewport = {
  themeColor: "#071B39",
  width: "device-width",
  initialScale: 1,
  // maximumScale intentionally NOT set (removed July 5 audit) — it was
  // pinned to 1, which disables pinch-to-zoom entirely. That's an
  // accessibility problem on its own, and it was actively blocking the one
  // workaround low-vision users have for any text that's still hard to read.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
