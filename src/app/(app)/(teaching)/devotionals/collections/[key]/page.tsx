import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CollectionScreen } from "@/components/devotionals/collection-screen";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isCalendarDate, isSlot } from "@/lib/devotionals/calendar";
import { isNotFound, reflectionFor } from "@/lib/devotionals/load";
import type { CollectionDay } from "@/lib/devotionals/types";
import { requireClient } from "@/lib/supabase/server";

// Generic: the collection is for members only.
export const metadata: Metadata = { title: "Devotional reading" };

const KEY = /^[a-z0-9][a-z0-9-]{1,59}$/;

/**
 * A collection's reading for a calendar date (the member's own "today" by
 * default) and morning or evening. Only this one reading is sent to the
 * browser.
 */
export default async function CollectionDayPage({ params, searchParams }: PageProps<"/devotionals/collections/[key]">) {
  const { key } = await params;
  if (!KEY.test(key)) notFound();
  const sp = await searchParams;
  await requireApprovedMember(`/devotionals/collections/${key}`);
  const supabase = await requireClient();
  const date = isCalendarDate(sp.date) ? sp.date : null;
  const slot = isSlot(sp.slot) ? sp.slot : null;
  const { data, error } = await supabase.rpc("media_collection_day", { p_key: key, p_date: date, p_slot: slot });
  if (isNotFound(error)) notFound();
  if (error || !data) {
    return (
      <>
        <BackLink route="/devotionals/collections/[key]" />
        <Alert tone="error" title="This reading couldn't be loaded right now." />
      </>
    );
  }
  const day = data as CollectionDay;
  const reflectionId = day.reading ? await reflectionFor(supabase, day.reading.id, day.date) : null;
  return (
    <>
      <BackLink route="/devotionals/collections/[key]" />
      <CollectionScreen
        collection={day.collection}
        date={day.date}
        slot={day.slot}
        today={day.today}
        localHour={day.local_hour}
        reading={day.reading}
        leapDay={day.leap_day}
        reflectionId={reflectionId}
      />
    </>
  );
}
