import type { ReactNode } from "react";
import { IconMark } from "@/components/brand/logo";
import { getChurchSettings } from "@/lib/settings/queries";
import { AuthHero } from "./hero";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const { settings } = await getChurchSettings();
  return (
    <div className="flex min-h-dvh flex-col bg-warm-ivory lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(28rem,2fr)]">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AuthHero churchName={settings.churchName} logoUrl={settings.logoUrl} />

      <div className="auth-theme relative -mt-5 flex flex-1 flex-col rounded-t-[1.25rem] lg:mt-0 lg:min-h-dvh lg:rounded-none">
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-[28rem] flex-1 flex-col px-5 pt-7 pb-10 outline-none sm:px-8 sm:pt-10 lg:justify-center lg:py-14"
        >
          {/* On phones the header above already shows the logo, so the mark appears on wider screens only. */}
          <IconMark src={settings.iconUrl} className="mx-auto mb-7 hidden h-16 lg:block" />
          {children}
        </main>
        <footer className="mx-auto w-full max-w-[28rem] px-5 pb-8 sm:px-8 lg:pb-12">
          <div aria-hidden="true" className="h-px bg-antique-gold" />
          <p className="mt-6 text-center font-serif text-meta tracking-[0.2em] text-text-secondary">
            Faith. Fellowship. Life together.
          </p>
        </footer>
      </div>
    </div>
  );
}
