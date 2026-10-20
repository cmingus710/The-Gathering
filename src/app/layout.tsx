import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { getThemePreference } from "@/lib/theme/server";
import { THEME_COLOR } from "@/lib/theme/tokens";

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

export async function generateViewport(): Promise<Viewport> {
  const theme = await getThemePreference();
  return {
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
            { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
          ]
        : THEME_COLOR[theme],
    colorScheme: theme === "system" ? "light dark" : theme,
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

/**
 * The saved theme is rendered into data-theme on the server, so the first
 * paint is already correct: no flash and no blocking script.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await getThemePreference();
  return (
    <html lang="en" data-theme={theme} className="h-full antialiased">
      <body className="min-h-full bg-background text-text">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
