import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
import { AuthProvider } from "@/components/AuthProvider";
import { ChatProvider } from "@/components/ChatProvider";
import { CompPlanProvider } from "@/components/CompPlanProvider";
import { CrmProvider } from "@/components/CrmProvider";
import { DealProvider } from "@/components/DealProvider";
import { GoalProvider } from "@/components/GoalProvider";
import { PayPlanProvider } from "@/components/PayPlanProvider";
import { ProfilePhotoProvider } from "@/components/ProfilePhotoProvider";
import { PwaRegistration } from "@/components/PwaRegistration";
import { StoreSettingsProvider } from "@/components/StoreSettingsProvider";
import { TeamProvider } from "@/components/TeamProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TelemetryReporter } from "@/components/TelemetryReporter";

export const metadata: Metadata = {
  metadataBase: new URL("https://commissioned41.com"),
  title: "Dealer Mission OS",
  description: "Kennesaw Mazda mission control operating system",
  applicationName: "Dealer Mission OS",
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Dealer Mission OS",
    title: "Dealer Mission OS",
    description: "Kennesaw Mazda mission control operating system",
    url: "https://commissioned41.com",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Dealer Mission OS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dealer Mission OS",
    description: "Kennesaw Mazda mission control operating system",
    images: ["/og.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Dealer Mission OS",
  },
  icons: {
    icon: [
      { url: "/favicon.ico?v=6", sizes: "any" },
      { url: "/mission-icon-192.png?v=6", sizes: "192x192", type: "image/png" },
      { url: "/mission-icon-512.png?v=6", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico?v=6" }],
    apple: [{ url: "/apple-touch-icon.png?v=6" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#f0f4fb", // Sky Command is the standard — browser chrome matches the light canvas
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <StoreSettingsProvider>
              <TeamProvider>
                <GoalProvider>
                  <PayPlanProvider>
                    <CompPlanProvider>
                    <ChatProvider>
                      <ProfilePhotoProvider>
                        <CrmProvider>
                          <DealProvider>
                            <AppShell>{children}</AppShell>
                            <PwaRegistration />
                            <TelemetryReporter />
                          </DealProvider>
                        </CrmProvider>
                      </ProfilePhotoProvider>
                    </ChatProvider>
                    </CompPlanProvider>
                  </PayPlanProvider>
                </GoalProvider>
              </TeamProvider>
            </StoreSettingsProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
