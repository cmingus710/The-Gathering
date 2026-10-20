import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { signCoverUrls } from "@/lib/events/images";
import { getEventsConfig } from "@/lib/events/server";
import type { DefaultBanner } from "@/lib/home/coming-up";
import { getChurchSettings } from "@/lib/settings/queries";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { HomeBannerForm } from "../home-banner-form";
import { CategoryForm, EventSettingsForm, RetryForm } from "./settings-forms";

export const metadata: Metadata = { title: "Event settings" };

type Settings = { public_feed_enabled: boolean; default_reminder_minutes: number[]; scheduler_configured: boolean; jobs_configured: boolean; outbox: Record<string, number> | null };
type Category = { id: string; name: string; active: boolean; sort_order: number; events: number };
type Mail = { id: string; kind: string; status: string; attempts: number; last_error: string | null; created_at: string; event: string; starts_at: string };

const KIND: Record<string, string> = {
  rsvp_confirmed: "Registration confirmation",
  waitlisted: "Waitlist notice",
  rsvp_canceled: "Cancellation confirmation",
  promoted: "Waitlist promotion",
  changed: "Change notice",
  occurrence_canceled: "Date canceled",
  event_canceled: "Event canceled",
  reminder: "Reminder",
};

export default async function EventSettingsPage() {
  await requireCapability(CAPABILITIES.eventsManage, "/admin/events/settings");
  const [supabase, { settings: church }] = await Promise.all([requireClient(), getChurchSettings()]);
  const [{ data: s }, { data: cats }, { data: mail }, banner] = await Promise.all([
    supabase.rpc("events_admin_settings"),
    supabase.rpc("events_admin_categories"),
    supabase.rpc("events_admin_outbox"),
    supabase.rpc("events_home_banner_default"),
  ]);
  const defaultBanner = banner.error ? undefined : (banner.data as DefaultBanner);
  const defaultUrl = defaultBanner?.path ? ((await signCoverUrls(supabase, [defaultBanner.path])).get(defaultBanner.path) ?? null) : null;
  const settings = s as Settings | null;
  const config = getEventsConfig();
  const queue = (mail ?? []) as Mail[];

  return (
    <>
      <Link href="/admin/events" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Events
      </Link>
      <PageHeader title="Event settings" description="Categories, the public calendar feed, reminders, the default Coming up banner, and email delivery." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeading as="h2">Categories</SectionHeading>
          <div className="divide-y divide-border">
            {((cats ?? []) as Category[]).map((c) => (
              <CategoryForm key={c.id} category={c} />
            ))}
            <CategoryForm />
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionHeading as="h2">Calendar and reminders</SectionHeading>
            {settings ? <EventSettingsForm publicFeed={settings.public_feed_enabled} reminders={settings.default_reminder_minutes} /> : null}
            {settings?.public_feed_enabled ? <p className="mt-3 break-all font-mono text-sm">{`${getSiteUrl()}/api/calendar/public`}</p> : null}
          </Card>
          <Card id="default-banner">
            <SectionHeading
              as="h2"
              description="Shown in “Coming up” on the member home page when the next event has neither its own homepage banner nor a cover image. Visible to approved members only."
            >
              Default Coming up banner
            </SectionHeading>
            {defaultBanner === undefined ? (
              <Alert tone="warning" title="Banner images need the latest database update." live={false}>
                Apply migration 20261023000100 (supabase/manual/2026-10-23-apply-home-banner.sql).
              </Alert>
            ) : (
              <HomeBannerForm
                scope="default"
                idPrefix="default-banner"
                current={defaultBanner ? { url: defaultUrl, alt: defaultBanner.alt, focusX: defaultBanner.focus_x, focusY: defaultBanner.focus_y } : null}
              />
            )}
          </Card>
          <Card className="space-y-3">
            <SectionHeading as="h2">Email delivery</SectionHeading>
            {!config.jobSecret || !settings?.jobs_configured ? (
              <Alert tone="warning" title="Event emails aren't being sent yet." live={false}>
                The events job secret isn&apos;t set up, so confirmations and reminders stay queued. See docs/events-guide.md.
              </Alert>
            ) : !settings.scheduler_configured ? (
              <Alert tone="warning" title="Reminders aren't scheduled yet." live={false}>
                Confirmations are sent right away, but reminders and retries need the database scheduler. See docs/events-guide.md.
              </Alert>
            ) : (
              <p className="text-text-secondary">Emails are sent right away and retried by the scheduler every 5 minutes.</p>
            )}
            {config.allowlist ? <p className="text-sm text-text-secondary">Test environment: email goes only to the {config.allowlist.length} allowlisted test {config.allowlist.length === 1 ? "address" : "addresses"}; everything else is marked suppressed.</p> : null}
            <p className="text-sm text-text-secondary">
              Sent: {settings?.outbox?.sent ?? 0} · Suppressed: {settings?.outbox?.suppressed ?? 0} · Skipped (no longer eligible): {settings?.outbox?.skipped ?? 0}
            </p>
            {queue.length ? (
              <ul className="divide-y divide-border">
                {queue.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="font-semibold">{KIND[m.kind] ?? m.kind} · {m.event}</p>
                      <p className="text-sm text-text-secondary">
                        {m.status} · {m.attempts} {m.attempts === 1 ? "attempt" : "attempts"} · queued {formatDateTime(m.created_at, church.timezone)}
                        {m.last_error ? ` · ${m.last_error}` : ""}
                      </p>
                    </div>
                    {m.status === "failed" ? <RetryForm id={m.id} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-secondary">No emails waiting or failed.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
