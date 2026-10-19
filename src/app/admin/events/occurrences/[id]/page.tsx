import { ArrowLeft, Download, Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RsvpBadge } from "@/components/events/event-badges";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { formatWhen } from "@/lib/events/format";
import type { EventOccurrence } from "@/lib/events/types";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { AdminCancelRegistrationForm, AdminRegisterForm, OccurrenceEditForm, OccurrenceStatusForm } from "./occurrence-forms";

export const metadata: Metadata = { title: "Event date" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminOccurrence = EventOccurrence & {
  detached: boolean;
  orphaned: boolean;
  override_date: string | null;
  override_start_time: string | null;
  override_duration: number | null;
  override_location_name: string | null;
  override_location_address: string | null;
  override_online_url: string | null;
  capacity: number | null;
  confirmed_count: number;
  waitlist_count: number;
};

type Attendee = {
  id: string;
  profile_id: string;
  name: string;
  email: string;
  status: "confirmed" | "waitlisted" | "canceled";
  position: number | null;
  queued_at: string;
  canceled_at: string | null;
  cancel_reason: string | null;
  source: "member" | "admin";
};

const REASON: Record<string, string> = { member: "by the member", admin: "by an organizer", ineligible: "no longer eligible" };

export default async function OccurrenceAdminPage({ params, searchParams }: PageProps<"/admin/events/occurrences/[id]">) {
  const { id } = await params;
  await requireCapability(CAPABILITIES.eventsManage, `/admin/events/occurrences/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const supabase = await requireClient();
  const [{ data }, { data: people, error }] = await Promise.all([
    supabase.rpc("events_admin_occurrence", { p_occurrence: id }),
    supabase.rpc("events_admin_attendees", { p_occurrence: id }),
  ]);
  const o = data as AdminOccurrence | null;
  if (!o) notFound();
  const attendees = (people ?? []) as Attendee[];
  const { data: found } = q.length >= 2 ? await supabase.rpc("events_admin_member_search", { p_query: q }) : { data: [] };
  const active = new Set(attendees.filter((a) => a.status !== "canceled").map((a) => a.profile_id));
  const results = ((found ?? []) as Array<{ id: string; name: string; email: string }>).filter((m) => !active.has(m.id));
  const upcoming = new Date(o.ends_at) > new Date();
  const editable = upcoming && o.series_status !== "canceled" && o.series_status !== "archived";
  const groups = (["confirmed", "waitlisted", "canceled"] as const).map((s) => ({ s, list: attendees.filter((a) => a.status === s) }));

  return (
    <>
      <Link href={`/admin/events/${o.series_id}`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> {o.title}
      </Link>
      <PageHeader
        title={formatWhen(o)}
        eyebrow={o.title}
        description={o.rsvp_enabled ? `${o.confirmed_count} registered${o.capacity ? ` of ${o.capacity}` : ""} · ${o.waitlist_count} on the waitlist` : "This event doesn't take registrations."}
        actions={
          <>
            <ButtonLink href={`/admin/events/occurrences/${o.id}/preview`} variant="secondary" icon={<Eye className="size-4" aria-hidden="true" />}>
              Preview
            </ButtonLink>
            {o.rsvp_enabled ? (
              <a href={`/admin/events/occurrences/${o.id}/export`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-muted px-4 font-semibold hover:border-border-strong">
                <Download className="size-4" aria-hidden="true" /> Export CSV
              </a>
            ) : null}
          </>
        }
      />
      {o.status === "canceled" ? <Alert tone="error" title="This date is canceled.">{o.cancel_reason ?? ""}</Alert> : null}
      <p className="mb-6 text-sm text-text-secondary">Attendee lists are private to event organizers. Exports are recorded in the audit log.</p>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {error ? <Alert tone="error" title="Attendees couldn't be loaded right now." /> : null}
          {groups.map(({ s, list }) =>
            list.length || s !== "canceled" ? (
              <Card key={s}>
                <SectionHeading as="h2">{s === "confirmed" ? "Registered" : s === "waitlisted" ? "Waitlist (in order)" : "Canceled"}</SectionHeading>
                {list.length ? (
                  <ul className="divide-y divide-border">
                    {list.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div>
                          <p className="font-semibold">
                            {s === "waitlisted" ? `${a.position}. ` : ""}
                            {a.name}
                          </p>
                          <p className="text-sm text-text-secondary">
                            {a.email} · {s === "canceled" ? `canceled ${a.canceled_at ? formatDateTime(a.canceled_at, o.timezone) : ""} ${REASON[a.cancel_reason ?? ""] ?? ""}` : `since ${formatDateTime(a.queued_at, o.timezone)}`}
                            {a.source === "admin" ? " · added by an organizer" : ""}
                          </p>
                        </div>
                        {s !== "canceled" && upcoming ? <AdminCancelRegistrationForm registrationId={a.id} name={a.name} /> : s === "canceled" ? <RsvpBadge state="canceled" /> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-text-secondary">{s === "confirmed" ? "Nobody yet." : "Nobody waiting."}</p>
                )}
              </Card>
            ) : null,
          )}
        </div>
        <div className="space-y-6">
          {o.rsvp_enabled && editable && o.status === "scheduled" ? (
            <Card className="space-y-3">
              <SectionHeading as="h2">Add a registration</SectionHeading>
              <form method="get" className="flex gap-2">
                <label className="flex-1">
                  <span className="sr-only">Search approved members</span>
                  <input name="q" defaultValue={q} placeholder="Name or email" className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
                </label>
                <button type="submit" className="min-h-11 rounded-full border border-border bg-surface-muted px-4 font-semibold">
                  Search
                </button>
              </form>
              {q.length >= 2 && !results.length ? <p className="text-text-secondary">No approved members match that search (or they&apos;re already registered).</p> : null}
              {results.map((m) => (
                <AdminRegisterForm key={m.id} occurrenceId={o.id} profileId={m.id} name={`${m.name} (${m.email})`} />
              ))}
            </Card>
          ) : null}
          {editable ? (
            <>
              <Card>
                <SectionHeading as="h2">This date</SectionHeading>
                <OccurrenceStatusForm id={o.id} canceled={o.status === "canceled"} />
              </Card>
              {o.status === "scheduled" ? (
                <Card>
                  <SectionHeading as="h2">Change this date only</SectionHeading>
                  <OccurrenceEditForm
                    id={o.id}
                    allDay={o.all_day}
                    initial={{
                      overrideDate: o.override_date ?? "",
                      overrideStartTime: o.override_start_time?.slice(0, 5) ?? "",
                      overrideDuration: o.override_duration?.toString() ?? "",
                      locationName: o.override_location_name ?? "",
                      locationAddress: o.override_location_address ?? "",
                      onlineUrl: o.override_online_url ?? "",
                      note: o.note ?? "",
                    }}
                  />
                </Card>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
