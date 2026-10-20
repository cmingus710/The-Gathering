import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventDetail } from "@/components/events/event-detail";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { signCoverUrls } from "@/lib/events/images";
import type { EventOccurrence } from "@/lib/events/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Preview event" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What members will see, for any status (organizers only). */
export default async function PreviewPage({ params }: PageProps<"/admin/events/occurrences/[id]/preview">) {
  const { id } = await params;
  await requireCapability(CAPABILITIES.eventsManage, `/admin/events/occurrences/${id}/preview`);
  if (!UUID.test(id)) notFound();
  const supabase = await requireClient();
  const { data } = await supabase.rpc("events_admin_occurrence", { p_occurrence: id });
  const o = data as EventOccurrence | null;
  if (!o) notFound();
  const covers = await signCoverUrls(supabase, [o.cover_path]);
  return (
    <>
      <Link href={`/admin/events/${o.series_id}`} className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to editing
      </Link>
      <Alert tone="info" title="Preview" live={false}>
        This is how the event page will look{o.series_status === "draft" ? " once published" : ""}. Registration buttons aren&apos;t shown here.
      </Alert>
      <div className="mt-6">
        <PageHeader eyebrow={o.category?.name ?? "Event"} title={o.status === "canceled" ? `Canceled: ${o.title}` : o.title} />
        <EventDetail o={o} coverUrl={o.cover_path ? covers.get(o.cover_path) : null} moreHref={(x) => `/admin/events/occurrences/${x}/preview`} />
      </div>
    </>
  );
}
