import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CollectionScreen } from "@/components/devotionals/collection-screen";
import { BackLink } from "@/components/ui/back-link";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { dateFitsReading, dateInYear, monthDay } from "@/lib/devotionals/calendar";
import { isNotFound, reflectionFor } from "@/lib/devotionals/load";
import type { CollectionReadingPage } from "@/lib/devotionals/types";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Devotional reading" };

/**
 * A direct link to one reading by its stable id. A reading has no year, so
 * it is shown on its date in the member's current year (?on= picks another
 * date of the same month and day; February 29 falls on February 28 in a
 * common year).
 */
export default async function CollectionReadingPage({ params, searchParams }: PageProps<"/devotionals/collections/[key]/readings/[id]">) {
  const { key, id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  await requireApprovedMember(`/devotionals/collections/${encodeURIComponent(key)}/readings/${id}`);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_collection_reading", { p_id: id });
  if (isNotFound(error) || !data) notFound();
  const page = data as CollectionReadingPage;
  if (page.collection.key !== key) notFound();
  const r = page.reading;
  const on = typeof sp.on === "string" && dateFitsReading(sp.on, r.month, r.day) ? sp.on : dateInYear(monthDay(page.today).year, r.month, r.day);
  const reflectionId = await reflectionFor(supabase, r.id, on);
  return (
    <>
      <BackLink route="/devotionals/collections/[key]/readings/[id]" params={{ key }} label={page.collection.title} />
      <CollectionScreen
        collection={page.collection}
        date={on}
        slot={r.slot}
        today={page.today}
        localHour={page.local_hour}
        reading={r}
        leapDay={null}
        reflectionId={reflectionId}
      />
    </>
  );
}
