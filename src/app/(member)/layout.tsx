import type { ReactNode } from "react";
import { MemberShell } from "@/components/layout/member-shell";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";

/** Approved members only. Pending/suspended accounts are sent to /account-status. */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const [viewer, { settings }] = await Promise.all([requireApprovedMember(), getChurchSettings()]);
  return (
    <MemberShell viewer={viewer} settings={settings}>
      {children}
    </MemberShell>
  );
}
