import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { requireAdminArea } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: { default: "Administration", template: "%s · Admin · The Gathering" } };

/** Approved members with at least one administrative capability. Each page re-checks its own capability. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [viewer, { settings }] = await Promise.all([requireAdminArea(), getChurchSettings()]);
  return (
    <AdminShell viewer={viewer} settings={settings}>
      {children}
    </AdminShell>
  );
}
