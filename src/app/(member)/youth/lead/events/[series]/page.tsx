import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Attendees, type YouthEventAdmin } from "@/components/youth/attendees";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Youth event" };

export default async function LeadEventPage({ params }: PageProps<"/youth/lead/events/[series]">) {
  const { series } = await params;
  if (!isUuid(series)) notFound();
  await requireApprovedMember(`/youth/lead/events/${series}`);
  const { data } = await youthRead<YouthEventAdmin>("youth_event_admin", { p_series: series });
  if (!data) return <Alert tone="error" title="This event couldn't be loaded right now." />;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/youth/lead" className="hover:underline">Leading</Link>}
        title={data.title}
        description={data.settings ? `Youth event for ${data.settings.group}` : undefined}
        actions={data.i_am_personnel ? <ButtonLink href={`/youth/lead/events/${series}/logistics`} variant="secondary">Event logistics</ButtonLink> : undefined}
      />
      <Attendees event={data} />
    </>
  );
}
