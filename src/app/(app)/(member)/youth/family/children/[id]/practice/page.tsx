import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { YouthForm } from "@/components/youth/youth-form";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { youthRead } from "@/lib/youth/queries";
import { ChildPractice } from "./practice-client";

export const metadata: Metadata = { title: "Practice together" };

type Practice = {
  independent: boolean;
  child?: { id: string; display_name: string };
  assigned?: Array<{ item_id: string; title: string | null; reference: string; collection: string; card_id: string | null }>;
  cards?: Array<{ id: string; reference: string; stage: string; due_on: string | null; review_ready: boolean; sessions: number; translation: string }>;
};

export default async function PracticePage({ params }: PageProps<"/youth/family/children/[id]/practice">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireApprovedMember(`/youth/family/children/${id}/practice`);
  const { data } = await youthRead<Practice>("youth_child_practice", { p_child: id });
  if (!data) return <Alert tone="error" title="Practice couldn't be loaded right now." />;
  if (data.independent) {
    return (
      <>
        <BackLink route="/youth/family/children/[id]/practice" params={{ id }} />
        <PageHeader title="Practice together" />
        <Alert tone="info" title="This child practices on their own account.">
          Their progress is theirs. You&apos;ll see a summary only if they choose to share one.
        </Alert>
      </>
    );
  }
  const name = data.child!.display_name;
  const unadded = (data.assigned ?? []).filter((a) => !a.card_id);
  return (
    <>
      <BackLink route="/youth/family/children/[id]/practice" params={{ id }} label={name} />
      <PageHeader
        title={`Practice with ${name}`}
        description={`Everything you do here is recorded as ${name}'s practice, not yours. Your own memory verses aren't affected.`}
      />
      <div className="space-y-10">
        <section aria-labelledby="verses">
          <SectionHeading id="verses">{name}&apos;s verses</SectionHeading>
          {(data.cards ?? []).length === 0 ? (
            <EmptyState glyph="memory" title="No verses yet">Add one of the verses assigned to their group below.</EmptyState>
          ) : (
            <ChildPractice child={id} childName={name} cards={data.cards!} />
          )}
        </section>
        {unadded.length ? (
          <section aria-labelledby="assigned">
            <SectionHeading id="assigned">Assigned to their group</SectionHeading>
            <ul className="space-y-2">
              {unadded.map((a) => (
                <li key={a.item_id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{a.title ?? a.reference}</p>
                      <p className="text-meta text-text-secondary">
                        {a.reference} · {a.collection}
                      </p>
                    </div>
                    <YouthForm op="card_add" hidden={{ child: id, item: a.item_id }} submit="Add" size="sm" inline pendingText="Adding…" />
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
