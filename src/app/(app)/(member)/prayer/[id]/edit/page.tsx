import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RequestComposer } from "@/components/prayer/request-composer";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { GroupOption, PrayerDetail } from "@/lib/prayer/types";
import { saveRequestAction } from "../../actions";

export const metadata: Metadata = { title: "Edit prayer request" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function EditPrayerPage({ params }: PageProps<"/prayer/[id]/edit">) {
  const { id } = await params;
  await requireApprovedMember(`/prayer/${id}/edit`);
  if (!UUID.test(id)) notFound();
  const [request, groups] = await Promise.all([
    tryCommunityRpc<PrayerDetail>("prayer_request", { p_id: id, p_limit: 1 }),
    tryCommunityRpc<GroupOption[]>("prayer_my_groups"),
  ]);
  if (!request || !request.mine) notFound();
  // Keep the current group selectable even if the author has since left it
  // (choosing it again would be refused; narrowing to private still works).
  const options = groups ?? [];
  if (request.group && !options.some((g) => g.id === request.group!.id) && request.group_member) options.push(request.group);
  return (
    <>
      <BackLink route="/prayer/[id]/edit" params={{ id }} />
      <PageHeader title="Edit prayer request" description="Narrowing who can see it takes effect at once. Widening asks you to confirm." />
      {request.status === "archived" ? (
        <Alert tone="info" title="Restore this request from the archive before editing it." />
      ) : (
        <RequestComposer
          action={saveRequestAction}
          groups={options}
          initial={{
            id: request.id,
            title: request.title,
            body: request.body,
            audience: request.audience,
            groupId: request.group?.id ?? null,
            anonymous: request.anonymous,
            commentsEnabled: request.comments_enabled,
          }}
        />
      )}
    </>
  );
}
