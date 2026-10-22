import type { ReactNode } from "react";
import { YouthShell } from "@/components/youth/youth-shell";
import { requireLearner } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";

/**
 * Approved accounts only (pending/suspended go to /account-status). Adults
 * get the member shell from the shared (app) layout. Independent youth
 * accounts get the youth shell: every adult-only page calls
 * requireApprovedMember() (directly or through a section layout), which
 * sends them to /youth, and only the learning tools (Bible, journal, memory
 * verses) admit them.
 */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const [viewer, { settings }] = await Promise.all([requireLearner(), getChurchSettings()]);
  if (viewer.accountKind === "youth") {
    return (
      <YouthShell viewer={viewer} settings={settings}>
        {children}
      </YouthShell>
    );
  }
  return children;
}
