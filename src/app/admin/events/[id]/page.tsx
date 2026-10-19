import { ArrowLeft, Eye, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudienceBadge, SeriesStatusBadge } from "@/components/events/event-badges";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { formatWhen, localTime } from "@/lib/events/format";
import { signCoverUrls } from "@/lib/events/images";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { EventForm } from "../event-form";
import { allTimeZones, seriesToForm, type AdminSeries } from "../series";
import { StatusControls } from "./status-controls";

export const metadata: Metadata = { title: "Edit event" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditEventPage({ params, searchParams }: PageProps<"/admin/events/[id]">) {
  const { id } = await params;
  await requireCapability(CAPABILITIES.eventsManage, `/admin/events/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const supabase = await requireClient();
  const [{ data }, { data: cats }, { data: groups }] = await Promise.all([
    supabase.rpc("events_admin_get", { p_series: id }),
    supabase.rpc("events_admin_categories"),
    supabase.rpc("events_admin_groups"),
  ]);
  const s = data as AdminSeries | null;
  if (!s) notFound();
  const covers = await signCoverUrls(supabase, [s.cover_path]);
  const now = new Date();
  const upcoming = s.occurrences.filter((o) => new Date(o.ends_at) > now);
  const hasRegistrations = upcoming.some((o) => o.confirmed + o.waitlisted > 0);
  const editable = s.status === "draft" || s.status === "published";
  const scheduled = s.status === "published" && !!s.publish_at && new Date(s.publish_at) > now;
  // Dates where daylight saving moved the start (nonexistent local time).
  const shifted = !s.all_day && s.start_time ? s.occurrences.filter((o) => !o.detached && localTime(o.starts_at, s.timezone) !== s.start_time!.slice(0, 5)) : [];
  const preview = upcoming[0] ?? s.occurrences[0];

  return (
    <>
      <Link href="/admin/events" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Events
      </Link>
      <PageHeader
        title={s.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SeriesStatusBadge status={s.status} scheduled={scheduled} />
            <AudienceBadge audience={s.audience} />
            {scheduled ? <span>Publishes {formatDateTime(s.publish_at!, s.timezone)}</span> : null}
          </span>
        }
        actions={
          preview ? (
            <ButtonLink href={`/admin/events/occurrences/${preview.id}/preview`} variant="secondary" icon={<Eye className="size-4" aria-hidden="true" />}>
              Preview
            </ButtonLink>
          ) : null
        }
      />
      {sp.saved ? (
        <Alert tone="success" title="Saved.">
          {Number(sp.notified) > 0 ? <p>{sp.notified} registration notices are being emailed about the change.</p> : null}
          {Number(sp.kept) > 0 ? <p>{sp.kept} removed {Number(sp.kept) === 1 ? "date was" : "dates were"} kept as canceled because people had registered.</p> : null}
        </Alert>
      ) : null}
      {s.status === "canceled" ? <Alert tone="error" title="This event is canceled.">{s.cancel_reason ?? "No reason given."}</Alert> : null}
      {shifted.length ? (
        <Alert tone="warning" title="Daylight saving moved some start times.">
          <p className="flex gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {shifted.length} {shifted.length === 1 ? "date falls" : "dates fall"} in a daylight-saving gap, so {shifted.length === 1 ? "it starts" : "they start"} an hour later. Edit those dates individually if needed.
          </p>
        </Alert>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6 xl:col-start-2 xl:row-start-1">
          <Card>
            <SectionHeading as="h2">Status</SectionHeading>
            <StatusControls id={s.id} status={s.status} timezone={s.timezone} hasRegistrations={hasRegistrations} />
          </Card>
          <Card>
            <SectionHeading as="h2">Dates and registrations</SectionHeading>
            {s.occurrences.length ? (
              <ul className="space-y-2">
                {s.occurrences.map((o) => (
                  <li key={o.id}>
                    <Link href={`/admin/events/occurrences/${o.id}`} className="block rounded-control px-3 py-2 hover:bg-surface-muted">
                      <span className={`block font-semibold ${o.status === "canceled" ? "line-through text-text-secondary" : ""}`}>
                        {o.status === "canceled" ? <span className="sr-only">Canceled: </span> : null}
                        {formatWhen({ starts_at: o.starts_at, ends_at: o.ends_at, timezone: s.timezone, all_day: s.all_day, local_date: o.occurrence_key, day_count: s.day_count })}
                      </span>
                      <span className="text-sm text-text-secondary">
                        {s.rsvp_enabled ? `${o.confirmed} registered${s.capacity ? ` of ${s.capacity}` : ""}${o.waitlisted ? ` · ${o.waitlisted} waiting` : ""}` : "No registration"}
                        {o.detached ? " · edited individually" : ""}
                        {o.orphaned ? " · removed from schedule" : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-secondary">No dates. Check the schedule settings.</p>
            )}
          </Card>
        </div>
        <div className="space-y-6 xl:col-start-1 xl:row-start-1">
          {editable ? (
            <EventForm
              initial={seriesToForm(s, s.cover_path ? (covers.get(s.cover_path) ?? null) : null)}
              categories={(cats ?? []) as Array<{ id: string; name: string; active: boolean }>}
              groups={(groups ?? []) as Array<{ id: string; name: string; visibility: "discoverable" | "hidden" }>}
              timezones={allTimeZones([s.timezone])}
              published={s.status === "published"}
            />
          ) : (
            <Card>
              <p className="text-text-secondary">Canceled and archived events can&apos;t be edited. {s.status === "archived" ? "Restore it as a draft to make changes." : ""}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
