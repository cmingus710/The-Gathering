import { CalendarPlus, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SeriesStatusBadge, AudienceBadge } from "@/components/events/event-badges";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import type { SeriesStatus } from "@/lib/events/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Events" };

type Row = {
  id: string;
  title: string;
  status: SeriesStatus;
  publish_at: string | null;
  audience: "public" | "members" | "group" | "youth";
  category: string | null;
  recurrence: string;
  timezone: string;
  next_start: string | null;
  first_start: string | null;
  occurrences: number;
  registrations: number;
};

export default async function AdminEventsPage({ searchParams }: PageProps<"/admin/events">) {
  await requireCapability(CAPABILITIES.eventsManage, "/admin/events");
  const sp = await searchParams;
  const filter = sp.show === "archived" ? "archived" : "current";
  const [supabase, { settings }] = await Promise.all([requireClient(), getChurchSettings()]);
  const { data, error } = await supabase.rpc("events_admin_list", { p_filter: filter });
  const rows = (data ?? []) as Row[];
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Events"
        description="Create, publish, and manage events and registrations."
        actions={
          <>
            <ButtonLink href="/admin/events/settings" variant="secondary" icon={<Settings2 className="size-4" aria-hidden="true" />}>
              Settings
            </ButtonLink>
            <ButtonLink href="/admin/events/new" icon={<CalendarPlus className="size-4" aria-hidden="true" />}>
              New event
            </ButtonLink>
          </>
        }
      />
      <nav aria-label="Event lists" className="mb-4 flex gap-2">
        {(["current", "archived"] as const).map((f) => (
          <Link
            key={f}
            href={f === "current" ? "/admin/events" : "/admin/events?show=archived"}
            aria-current={filter === f ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 font-semibold ${filter === f ? "border-cta bg-cta text-on-cta" : "border-border bg-surface-muted"}`}
          >
            {f === "current" ? "Current" : "Archived"}
          </Link>
        ))}
      </nav>
      {error ? (
        <Alert tone="error" title="Events couldn't be loaded right now." />
      ) : rows.length ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/events/${r.id}`} className="block rounded-card border border-border bg-surface px-5 py-4 hover:bg-surface-muted">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-title font-semibold">{r.title}</span>
                  <SeriesStatusBadge status={r.status} scheduled={r.status === "published" && !!r.publish_at && new Date(r.publish_at) > now} />
                  <AudienceBadge audience={r.audience} />
                </div>
                <p className="text-meta text-text-secondary">
                  {r.next_start ? `Next: ${formatDateTime(r.next_start, r.timezone)}` : r.first_start ? `Started ${formatDateTime(r.first_start, r.timezone)}` : "No dates"}
                  {r.recurrence !== "none" ? ` · ${r.occurrences} dates` : ""}
                  {r.category ? ` · ${r.category}` : ""}
                  {` · ${r.registrations} active ${r.registrations === 1 ? "registration" : "registrations"}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<CalendarPlus className="size-8" aria-hidden="true" />} title={filter === "archived" ? "No archived events" : "No events yet"}>
          {filter === "archived" ? "Archived events appear here." : `Create an event to get started. Times use ${settings.timezone.replace(/_/g, " ")} by default.`}
        </EmptyState>
      )}
    </>
  );
}
