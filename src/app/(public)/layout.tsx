import type { ReactNode } from "react";
import { WelcomeFooter } from "@/components/welcome/welcome-footer";
import { WelcomeHeader } from "@/components/welcome/welcome-header";
import { getViewer } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [{ settings }, viewer] = await Promise.all([getChurchSettings(), getViewer()]);
  return (
    <div className="welcome-theme flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <WelcomeHeader churchName={settings.churchName} iconUrl={settings.iconUrl} signedIn={viewer.state === "signed-in"} />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <WelcomeFooter settings={settings} />
    </div>
  );
}
