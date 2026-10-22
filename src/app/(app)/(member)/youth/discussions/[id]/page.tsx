import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { SelectField, TextAreaField } from "@/components/ui/field";
import { AudienceNote } from "@/components/youth/audience";
import { YouthForm } from "@/components/youth/youth-form";
import { requireYouthArea } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { REPORT_REASONS, formatWhen } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";
import type { Audience } from "@/lib/youth/types";

export const metadata: Metadata = { title: "Group discussion" };

type Discussion = {
  id: string;
  group_id: string;
  group: string;
  title: string;
  kind: string;
  status: string;
  hidden: boolean;
  role: "leader" | "youth" | "guardian";
  can_post: boolean;
  supervised: boolean;
  audience: Audience;
  posts: Array<{ id: string; author: string; mine: boolean; status: string; created_at: string; body: string }>;
};

function ReportForm({ discussion, post }: { discussion: string; post?: string }) {
  return (
    <details>
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-meta font-semibold text-text-secondary hover:text-text">Report</summary>
      <YouthForm op="report" hidden={{ discussion, post }} submit="Send report" size="sm" variant="secondary" className="mt-2 space-y-3">
        <SelectField id={`reason-${post ?? discussion}`} label="What's wrong?" name="reason" defaultValue="unsafe">
          {Object.entries(REPORT_REASONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <TextAreaField id={`note-${post ?? discussion}`} label="Anything else (optional)" name="note" rows={2} maxLength={500} optional />
      </YouthForm>
    </details>
  );
}

export default async function DiscussionPage({ params }: PageProps<"/youth/discussions/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireYouthArea(`/youth/discussions/${id}`);
  const { data: d } = await youthRead<Discussion>("youth_discussion", { p_id: id });
  if (!d) return <Alert tone="error" title="This discussion couldn't be loaded right now." />;
  const leader = d.role === "leader";
  return (
    <>
      <BackLink route="/youth/discussions/[id]" params={{ group: d.group_id }} label={d.group} />
      <PageHeader title={`${d.kind === "prayer" ? "Prayer: " : ""}${d.title}`} />
      <div className="space-y-6">
        <Card>
          <AudienceNote audience={d.audience} />
          {d.kind === "prayer" ? (
            <p className="mt-2 text-meta text-text-secondary">
              Prayer shared here is seen by everyone listed above. For something you&apos;d rather keep private, talk to a parent or guardian, a leader in
              person, or the church office.
            </p>
          ) : null}
        </Card>
        {d.hidden ? <Alert tone="warning" title="This discussion is hidden by a moderator." /> : null}
        {d.status !== "open" ? <Alert tone="info" title={d.status === "locked" ? "This discussion is closed to new messages." : "This discussion is archived."} /> : null}
        {!d.supervised && d.status === "open" ? (
          <Alert tone="info" title="Posting is paused until the group has enough leaders and members." />
        ) : null}
        <ol className="space-y-3">
          {d.posts.map((p) => (
            <li key={p.id} className="rounded-card border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-text-secondary">
                <span className="font-semibold text-text">{p.status === "deleted" ? "Deleted message" : p.author}</span>
                <time dateTime={p.created_at}>{formatWhen(p.created_at)}</time>
              </div>
              {p.status === "deleted" ? null : (
                <>
                  {p.status === "hidden" ? <Badge tone="danger">Hidden by a moderator</Badge> : null}
                  <p className="mt-1 whitespace-pre-wrap break-words">{p.body}</p>
                </>
              )}
              {p.status !== "deleted" ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {p.mine ? <YouthForm op="post_delete" hidden={{ id: p.id }} submit="Delete" size="sm" variant="ghost" inline pendingText="Deleting…" /> : <ReportForm discussion={d.id} post={p.id} />}
                  {leader ? (
                    <YouthForm
                      op="moderate"
                      hidden={{ target: "post", id: p.id, action: p.status === "hidden" ? "restore" : "hide" }}
                      submit={p.status === "hidden" ? "Restore" : "Hide"}
                      size="sm"
                      variant="secondary"
                      inline
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {d.can_post ? (
          <section aria-labelledby="reply">
            <SectionHeading id="reply">Reply</SectionHeading>
            <YouthForm op="post" hidden={{ discussion: d.id, client_key: randomUUID() }} submit="Post" pendingText="Posting…">
              <TextAreaField label="Your message" name="body" rows={4} maxLength={4000} required hint="Be kind. Everyone listed above can read this. Never share phone numbers, addresses, or ways to talk privately." />
            </YouthForm>
          </section>
        ) : d.role === "guardian" ? (
          <p className="text-meta text-text-secondary">Parents and guardians can read group discussions but don&apos;t post in them.</p>
        ) : null}
        {leader ? (
          <section aria-labelledby="mod" className="flex flex-wrap gap-2">
            <h2 id="mod" className="sr-only">
              Leader actions
            </h2>
            {d.status === "open" ? <YouthForm op="moderate" hidden={{ target: "discussion", id: d.id, action: "lock" }} submit="Close discussion" size="sm" variant="secondary" inline /> : null}
            {d.status === "locked" ? <YouthForm op="moderate" hidden={{ target: "discussion", id: d.id, action: "unlock" }} submit="Reopen" size="sm" variant="secondary" inline /> : null}
            {d.status !== "archived" ? <YouthForm op="moderate" hidden={{ target: "discussion", id: d.id, action: "archive" }} submit="Archive" size="sm" variant="danger-outline" inline /> : null}
          </section>
        ) : (
          <ReportForm discussion={d.id} />
        )}
      </div>
    </>
  );
}
