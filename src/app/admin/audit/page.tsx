import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Audit log" };

type Entry = {
  id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  actor: { full_name: string; email: string } | null;
};

function describe(e: Entry, names: Map<string, string>): string {
  const target = e.target_id ? (names.get(e.target_id) ?? "a member") : "";
  const d = e.details as Record<string, string | string[]>;
  switch (e.action) {
    case "membership.status_changed":
      return `Changed ${target} from ${d.from} to ${d.to}`;
    case "role.granted":
      return `Assigned the ${String(d.role).replace(/_/g, " ")} role to ${target}`;
    case "role.revoked":
      return `Removed the ${String(d.role).replace(/_/g, " ")} role from ${target}`;
    case "settings.updated":
      return `Updated church settings (${(d.fields as string[]).join(", ").replace(/_/g, " ")})`;
    case "announcement.created":
      return `Created an announcement (${d.status})`;
    case "announcement.status_changed":
      return `Changed an announcement from ${d.status_from} to ${d.status_to}`;
    case "announcement.updated":
      return `Edited an announcement (${((d.fields as string[]) ?? []).join(", ").replace(/_/g, " ")})`;
    case "bootstrap.super_admin_appointed":
      return `Appointed ${target} as the initial super administrator`;
    default:
      return e.action;
  }
}

export default async function AuditPage() {
  await requireCapability(CAPABILITIES.auditView, "/admin/audit");
  const supabase = await requireClient();
  const { settings } = await getChurchSettings();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, target_type, target_id, details, created_at, actor:profiles!audit_log_actor_id_fkey(full_name, email)")
    .order("id", { ascending: false })
    .limit(200)
    .returns<Entry[]>();

  const profileIds = [...new Set((data ?? []).filter((e) => e.target_type === "profile" && e.target_id).map((e) => e.target_id!))];
  const names = new Map<string, string>();
  if (profileIds.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", profileIds);
    for (const p of people ?? []) names.set(p.id, p.full_name || p.email);
  }

  return (
    <>
      <PageHeader title="Audit log" description="Administrative changes, most recent first. Content and passwords are never recorded." />
      {error ? (
        <Alert tone="error" title="The audit log couldn't be loaded." />
      ) : !data?.length ? (
        <EmptyState icon={<ClipboardList className="size-5" aria-hidden="true" />} title="No administrative changes yet" />
      ) : (
        <ol className="divide-y divide-border rounded-card border border-border bg-surface">
          {data.map((e) => (
            <li key={e.id} className="px-4 py-3 sm:px-5">
              <p className="font-semibold">{describe(e, names)}</p>
              <p className="text-meta text-text-secondary">
                {e.actor ? e.actor.full_name || e.actor.email : "System"} ·{" "}
                <time dateTime={e.created_at}>{formatDateTime(e.created_at, settings.timezone)}</time>
              </p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
