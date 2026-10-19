import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { addDays, localDate } from "@/lib/events/format";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { EventForm } from "../event-form";
import { allTimeZones } from "../series";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage() {
  await requireCapability(CAPABILITIES.eventsManage, "/admin/events/new");
  const [supabase, { settings }] = await Promise.all([requireClient(), getChurchSettings()]);
  const { data } = await supabase.rpc("events_admin_categories");
  const { data: config } = await supabase.rpc("events_admin_settings");
  const defaults = ((config as { default_reminder_minutes?: number[] } | null)?.default_reminder_minutes ?? [1440]) as number[];
  const tz = settings.timezone;
  return (
    <>
      <Link href="/admin/events" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Events
      </Link>
      <PageHeader title="New event" description="Saved as a draft. Preview it, then publish when it's ready." />
      <EventForm
        published={false}
        categories={(data ?? []) as Array<{ id: string; name: string; active: boolean }>}
        timezones={allTimeZones([tz])}
        initial={{
          title: "",
          description: "",
          categoryId: "",
          audience: "members",
          timezone: tz,
          allDay: false,
          startDate: addDays(localDate(new Date(), tz), 7),
          startTime: "18:00",
          endDate: "",
          endTime: "19:30",
          locationName: "",
          locationAddress: "",
          onlineUrl: "",
          organizerName: "",
          rsvpEnabled: false,
          capacity: "",
          waitlistEnabled: false,
          rsvpCloseHours: "",
          cancellationInstructions: "",
          reminders: defaults,
          recurrence: "none",
          interval: "1",
          weekdays: [],
          monthlyMode: "day",
          monthOrdinal: "1",
          endMode: "until",
          untilDate: "",
          occurrenceLimit: "",
          coverAlt: "",
          coverUrl: null,
        }}
      />
    </>
  );
}
