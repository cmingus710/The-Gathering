import { Suspense, type ReactNode } from "react";
import { MemberShell } from "@/components/layout/member-shell";
import { PublicHeader } from "@/components/layout/public-header";
import { ReturnViewRecorder } from "@/components/ui/back-link";
import { getViewer } from "@/lib/auth/viewer";
import { getUnreadCounts } from "@/lib/community/queries";
import { getChurchSettings } from "@/lib/settings/queries";

/**
 * Devotionals, Sunday lessons, podcasts, and the teaching hub are open to
 * visitors, who see only what a publisher made public. Approved members
 * (who also see members and group content) get the usual app shell;
 * everyone else gets the public header. Each database call applies the
 * audience rules for the caller.
 */
export default async function TeachingLayout({ children }: { children: ReactNode }) {
  const [{ settings }, result] = await Promise.all([getChurchSettings(), getViewer()]);
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
      <Suspense fallback={null}>
        <ReturnViewRecorder />
      </Suspense>
      <PublicHeader churchName={settings.churchName} iconUrl={settings.iconUrl} signedIn={result.state === "signed-in"} />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pb-[calc(4rem+env(safe-area-inset-bottom)+var(--player-clearance,0rem))] pt-4 outline-none sm:px-6">
        {children}
      </main>
    </div>
  );
}
