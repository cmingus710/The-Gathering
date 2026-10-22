import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventDetail } from "@/components/events/event-detail";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { getViewer } from "@/lib/auth/viewer";
import { googleCalendarUrl } from "@/lib/events/ics";
import { signCoverUrls } from "@/lib/events/images";
import { getOccurrence } from "@/lib/events/queries";
import { rsvpState } from "@/lib/events/types";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";
import { RsvpPanel } from "./rsvp-panel";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Event" };

/**
 * One occurrence. The database returns nothing for drafts, archived events,
 * and events outside the caller's audience, which all show "not found".
 */
export default async function EventPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [supabase, viewer] = await Promise.all([requireClient(), getViewer()]);
  const result = await getOccurrence(supabase, id);
  if (!result.ok) {
    return <Alert tone="error" title="This event couldn't be loaded right now.">Please try again in a moment.</Alert>;
  }
  const o = result.data;
  if (!o) notFound();
  const covers = await signCoverUrls(supabase, [o.cover_path]);
  const approved = viewer.state === "signed-in" && viewer.viewer.status === "approved";

  return (
    <>
      <BackLink route="/events/[id]" />
      <PageHeader eyebrow={o.category?.name ?? "Event"} title={o.status === "canceled" ? `Canceled: ${o.title}` : o.title} />
      <EventDetail
        o={o}
        coverUrl={o.cover_path ? covers.get(o.cover_path) : null}
        aside={
          <RsvpPanel
            occurrenceId={o.id}
            state={rsvpState(o)}
            position={o.my_position}
            spotsLeft={o.spots_left}
            canRegister={approved}
            signedIn={viewer.state === "signed-in"}
            googleUrl={googleCalendarUrl(o, getSiteUrl())}
            canceled={o.status === "canceled"}
          />
        }
      />
    </>
  );
}
