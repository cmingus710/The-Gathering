import type { ReactNode } from "react";
import { MemberShell } from "@/components/layout/member-shell";
import { PublicHeader } from "@/components/layout/public-header";
import { getViewer, shellViewer } from "@/lib/auth/viewer";
import { getUnreadCounts } from "@/lib/community/queries";
import { getChurchSettings } from "@/lib/settings/queries";

/**
 * Giving is open to everyone: guests and accounts in any membership state
 * can give and see their own records. Approved members get the usual app
 * shell; everyone else gets the public header.
 */
export default async function GivingLayout({ children }: { children: ReactNode }) {
  const [{ settings }, result] = await Promise.all([getChurchSettings(), getViewer()]);
  // Approved adults already have the member shell from the (app) layout.
  if (shellViewer(result)) return children;
  if (result.state === "signed-in" && result.viewer.status === "approved") {
    const counts = await getUnreadCounts();
    return (
      <MemberShell viewer={result.viewer} settings={settings} counts={counts}>
        {children}
      </MemberShell>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <PublicHeader churchName={settings.churchName} iconUrl={settings.iconUrl} signedIn={result.state === "signed-in"} />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-4 outline-none sm:px-6">
        {children}
      </main>
    </div>
  );
}
