import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";

// Every page depends on the request (session cookies, live settings, the
// current time for scheduled announcements), so nothing is prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "The Gathering", template: "%s · The Gathering" },
  description: "The Gathering church community app.",
  applicationName: "The Gathering",
  appleWebApp: { capable: true, title: "The Gathering", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#121110",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-text">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
