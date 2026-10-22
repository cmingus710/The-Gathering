import { CalendarCheck, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { EventListItem } from "@/components/events/event-list-item";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { getMyPrefs, getMyRegistrations, publicFeedEnabled } from "@/lib/events/queries";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { getChurchSettings } from "@/lib/settings/queries";
import { FeedControls, RemindersForm } from "./calendar-forms";

export const metadata: Metadata = { title: "Calendar & reminders" };

export default async function CalendarSettingsPage() {
  await requireApprovedMember("/events/calendar");
  const [supabase, { settings }] = await Promise.all([requireClient(), getChurchSettings()]);
  const [registrations, prefs, publicFeed] = await Promise.all([getMyRegistrations(supabase), getMyPrefs(supabase), publicFeedEnabled(supabase)]);
  const siteUrl = getSiteUrl();
  const now = new Date();

  return (
    <>
      <BackLink route="/events/calendar" />
      <PageHeader title="Calendar & reminders" description="Your registrations, your private calendar subscription, and reminder emails." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="mine">
          <SectionHeading id="mine">Your upcoming registrations</SectionHeading>
          {!registrations.ok ? (
            <Alert tone="error" title="Your registrations couldn't be loaded right now." />
          ) : registrations.data.length ? (
            <ul className="space-y-2">
              {registrations.data.map((o) => (
                <EventListItem key={o.id} o={o} now={now} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={<CalendarCheck className="size-8" aria-hidden="true" />} title="No registrations yet">
              Events you register for, or are waitlisted for, appear here.
            </EmptyState>
          )}
        </section>
        <div className="space-y-6">
          <Card className="space-y-4">
            <SectionHeading as="h2">Private calendar subscription</SectionHeading>
            <p className="text-meta text-text-secondary">
              Subscribe once and the events you&apos;re registered for appear in your calendar app, including changes and cancellations.
              Calendar apps check for updates on their own schedule (often every few hours; Google Calendar can take up to a day).
            </p>
            <Alert tone="warning" title="Keep this link private" live={false}>
              <p className="flex gap-2 text-meta">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Anyone who has the link can read the details of the events in it. If you shared it by mistake, create a new link.
              </p>
            </Alert>
            {prefs.feed_created_at ? <p className="text-sm text-text-secondary">Your current link was created {formatDate(prefs.feed_created_at, settings.timezone)}.</p> : null}
            <FeedControls active={Boolean(prefs.feed_created_at)} siteUrl={siteUrl} />
          </Card>
          <Card className="space-y-3">
            <SectionHeading as="h2">Reminders</SectionHeading>
            <RemindersForm enabled={prefs.reminders} />
          </Card>
          {publicFeed ? (
            <Card className="space-y-2">
              <SectionHeading as="h2">Church calendar</SectionHeading>
              <p className="text-meta text-text-secondary">All public events. Anyone can subscribe:</p>
              <p className="break-all font-mono text-sm">{`${siteUrl}/api/calendar/public`}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
