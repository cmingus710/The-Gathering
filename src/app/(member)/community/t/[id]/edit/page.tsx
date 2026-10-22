import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThreadComposer } from "@/components/community/composer";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { ThreadDetail } from "@/lib/community/types";
import { editThreadAction } from "../../../actions";

export const metadata: Metadata = { title: "Edit discussion" };

export default async function EditThreadPage({ params }: PageProps<"/community/t/[id]/edit">) {
  const { id } = await params;
  await requireApprovedMember(`/community/t/${id}/edit`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const thread = await tryCommunityRpc<ThreadDetail>("community_thread", { p_id: id, p_limit: 1 });
  if (!thread || !thread.mine || thread.status !== "visible") notFound();
  return (
    <>
      <BackLink route="/community/t/[id]/edit" params={{ id }} />
      <PageHeader title="Edit discussion" description="Edits replace the text; the post shows that it was edited." />
      {thread.locked ? (
        <Alert tone="info" title="This discussion is locked, so it can't be edited." />
      ) : (
        <Card>
          <ThreadComposer
            action={editThreadAction}
            audience={thread.audience}
            place={thread.group?.name ?? thread.category?.name ?? "the community"}
            hidden={{ threadId: id }}
            initial={{ title: thread.title ?? "", body: thread.body ?? "" }}
            submitLabel="Save changes"
          />
        </Card>
      )}
    </>
  );
}
