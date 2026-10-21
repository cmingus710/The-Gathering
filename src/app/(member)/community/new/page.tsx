import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThreadComposer } from "@/components/community/composer";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { Category, GroupDetail } from "@/lib/community/types";
import { createThreadAction } from "../actions";

export const metadata: Metadata = { title: "New discussion" };

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Composer. The place (a church-wide category or one of the member's
 * groups) is chosen first, so the audience is shown before writing.
 */
export default async function NewThreadPage({ searchParams }: PageProps<"/community/new">) {
  await requireApprovedMember("/community/new");
  const sp = await searchParams;
  const categoryId = typeof sp.category === "string" && UUID.test(sp.category) ? sp.category : null;
  const groupId = typeof sp.group === "string" && UUID.test(sp.group) ? sp.group : null;
  const guidelines = await tryCommunityRpc<{ acked: boolean; posting_restricted: boolean }>("community_guidelines");
  if (guidelines && !guidelines.acked) {
    const next = `/community/new${groupId ? `?group=${groupId}` : categoryId ? `?category=${categoryId}` : ""}`;
    redirect(`/community/guidelines?next=${encodeURIComponent(next)}`);
  }

  const back = (
    <Link href={groupId ? `/groups/${groupId}` : categoryId ? `/community/c/${categoryId}` : "/community"} className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
      <ArrowLeft className="size-4" aria-hidden="true" /> Back
    </Link>
  );

  if (guidelines?.posting_restricted) {
    return (
      <>
        {back}
        <PageHeader title="New discussion" />
        <Alert tone="warning" title="Your community posting is paused by a moderator.">
          You can still read discussions. <Link href="/community/guidelines" className="font-semibold text-primary underline">Details</Link>
        </Alert>
      </>
    );
  }

  if (groupId) {
    const group = await tryCommunityRpc<GroupDetail>("community_group", { p_id: groupId });
    if (!group?.is_member || group.status !== "active") {
      return (
        <>
          {back}
          <PageHeader title="New discussion" />
          <Alert tone="error" title="Only members of an active group can post in it." />
        </>
      );
    }
    return (
      <>
        {back}
        <PageHeader title="New group discussion" description={`In ${group.name}`} />
        <Card>
          <ThreadComposer action={createThreadAction} audience="group" place={group.name} hidden={{ groupId }} submitLabel="Post to group" attachments />
        </Card>
      </>
    );
  }

  const categories = (await tryCommunityRpc<Category[]>("community_categories")) ?? [];
  const category = categories.find((c) => c.id === categoryId);
  if (!category) {
    return (
      <>
        {back}
        <PageHeader title="New discussion" description="Where would you like to post?" />
        {categories.length ? (
          <ul className="space-y-2">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/community/new?category=${c.id}`} className="block rounded-card border border-border bg-surface px-5 py-4 hover:bg-surface-muted">
                  <span className="block font-semibold">{c.name}</span>
                  {c.description ? <span className="block text-meta text-text-secondary">{c.description}</span> : null}
                  <span className="mt-1 block text-sm text-text-secondary">Church-wide: all approved members can read it</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Alert tone="info" title="There are no discussion categories yet." />
        )}
        <p className="mt-6 text-text-secondary">
          To post privately to a group, open the group from <Link href="/groups" className="font-semibold text-primary underline">Groups</Link>.
        </p>
      </>
    );
  }
  return (
    <>
      {back}
      <PageHeader title="New discussion" description={`In ${category.name}`} />
      <Card>
        <ThreadComposer action={createThreadAction} audience="church" place={category.name} hidden={{ categoryId: category.id }} submitLabel="Post discussion" attachments />
      </Card>
    </>
  );
}
