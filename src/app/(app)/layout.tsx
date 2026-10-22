import type { ReactNode } from "react";
import { AccountBoundary } from "@/components/layout/account-boundary";
import { MemberShell } from "@/components/layout/member-shell";
import { getViewer, shellViewer } from "@/lib/auth/viewer";
import { getUnreadCounts } from "@/lib/community/queries";
import { getChurchSettings } from "@/lib/settings/queries";

/**
 * The app shell shared by the member area and the sections open to visitors
 * (events, teaching, giving). Approved adult members get the member shell
 * here, once, so moving between those sections keeps the header, dock, and
 * live notification connection mounted instead of rebuilding them on every
 * tap. Everyone else gets no chrome from this layout: each section's own
 * layout decides (sign-in redirect, account status, youth shell, or the
 * public header), and every page and database call still checks access.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // The unread counts start alongside the account check; for anyone who
  // isn't an approved member the database returns zero counts.
  const [result, { settings }, counts] = await Promise.all([getViewer(), getChurchSettings(), getUnreadCounts()]);
  const viewer = shellViewer(result);
  const boundary = <AccountBoundary accountId={result.state === "signed-in" ? result.viewer.id : null} />;
  if (!viewer) {
    return (
      <>
        {boundary}
        {children}
      </>
    );
  }
  return (
    <MemberShell viewer={viewer} settings={settings} counts={counts}>
      {boundary}
      {children}
    </MemberShell>
  );
}

