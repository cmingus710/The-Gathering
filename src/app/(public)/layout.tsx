import type { ReactNode } from "react";
import { PublicHeader } from "@/components/layout/public-header";
import { getViewer } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [{ settings }, viewer] = await Promise.all([getChurchSettings(), getViewer()]);
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <PublicHeader churchName={settings.churchName} iconUrl={settings.iconUrl} signedIn={viewer.state === "signed-in"} />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-[0.95rem] text-text-secondary sm:px-6">
          <p>© {new Date().getFullYear()} {settings.churchName}</p>
          <a href="/install" className="font-semibold text-primary underline-offset-2 hover:underline">
            Add the app to your Home Screen
          </a>
        </div>
      </footer>
    </div>
  );
}
