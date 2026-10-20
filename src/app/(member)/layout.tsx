import type { ReactNode } from "react";
import { MemberShell } from "@/components/layout/member-shell";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getUnreadCounts } from "@/lib/community/queries";
import { getChurchSettings } from "@/lib/settings/queries";

/** Approved members only. Pending/suspended accounts are sent to /account-status. */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const [viewer, { settings }] = await Promise.all([requireApprovedMember(), getChurchSettings()]);
  const counts = await getUnreadCounts();
  return (
    <MemberShell viewer={viewer} settings={settings} counts={counts}>
      {children}
    </MemberShell>
  );
}
