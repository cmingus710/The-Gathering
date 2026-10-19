import Link from "next/link";
import type { ReactNode } from "react";
import { LogoPlaque } from "@/components/brand/logo";
import { getChurchSettings } from "@/lib/settings/queries";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const { settings } = await getChurchSettings();
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
      <Link href="/" className="mb-6 block rounded-control sm:mb-8" aria-label={`${settings.churchName} home`}>
        <LogoPlaque src={settings.logoUrl} alt={settings.churchName} logoClassName="w-32 sm:w-40" priority />
      </Link>
      <main id="main" className="w-full max-w-md">
        <div className="rounded-card bg-surface p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
