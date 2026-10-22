import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToggleForm } from "@/components/community/toggle-form";
import { VolunteerForm } from "@/components/prayer/volunteer-form";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { OPPORTUNITY_STATUS_LABEL, SIGNUP_LABEL } from "@/lib/prayer/format";
import type { OpportunityDetail } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { formatDateTime } from "@/lib/time";
import { volunteerAction } from "../../care-actions";

export const metadata: Metadata = { title: "Help opportunity" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function OpportunityPage({ params }: PageProps<"/prayer/serve/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/prayer/serve/${id}`);
  if (!UUID.test(id)) notFound();
  const [o, { settings }] = await Promise.all([tryCommunityRpc<OpportunityDetail>("care_opportunity", { p_id: id }), getChurchSettings()]);
  if (!o) notFound();
  const tz = settings.timezone;
  return (
    <>
      <BackLink route="/prayer/serve/[id]" />
      <header className="mb-6">
        <p className="mb-1 text-meta font-semibold text-primary">{OPPORTUNITY_STATUS_LABEL[o.status]}{o.my_status ? ` · ${SIGNUP_LABEL[o.my_status]}` : ""}</p>
        <h1 className="font-display text-[1.75rem] font-semibold leading-tight">{o.title}</h1>
        <p className="mt-1 text-text-secondary">
          {formatDateTime(o.starts_at, tz)}
          {o.ends_at ? ` – ${formatDateTime(o.ends_at, tz)}` : ""} · {o.accepted_count} of {o.helpers_needed} helpers confirmed
        </p>
      </header>
      <div className="max-w-2xl space-y-6">
        {o.details ? (
          <Card>
            <p className="whitespace-pre-wrap">{o.details}</p>
          </Card>
        ) : null}
        {o.private ? (
          <Card className="space-y-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <Lock className="size-4 text-primary" aria-hidden="true" /> For confirmed volunteers
            </h2>
            {o.private.consent ? (
              <>
                {o.private.requester_first_name ? <p>You&apos;re helping <strong>{o.private.requester_first_name}</strong>.</p> : null}
                {o.private.logistics ? <p className="whitespace-pre-wrap">{o.private.logistics}</p> : <p className="text-text-secondary">The coordinator hasn&apos;t added logistics yet.</p>}
              </>
            ) : (
              <p className="text-text-secondary">The person you&apos;re helping hasn&apos;t chosen to share their details. The coordinator will tell you what you need.</p>
            )}
            {o.private.coordinator ? <p className="text-meta text-text-secondary">Coordinator: {o.private.coordinator}. Please keep these details private.</p> : null}
          </Card>
        ) : null}
        {o.can_volunteer ? (
          <Card>
            <VolunteerForm opportunityId={o.id} />
          </Card>
        ) : o.my_status === "offered" || o.my_status === "accepted" ? (
          <ToggleForm action={volunteerAction} hidden={{ opportunityId: o.id, on: "false" }} label="Withdraw my offer" pressed={false} description="Let the coordinator know you can no longer help" />
        ) : o.status !== "open" ? (
          <Alert tone="info" title="This opportunity isn't taking new volunteers." />
        ) : null}
      </div>
    </>
  );
}
