import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { YouthForm } from "@/components/youth/youth-form";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { formatWhen } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";
import type { Announcement, Learning } from "@/lib/youth/types";

export const metadata: Metadata = { title: "Lead a youth group" };

type Roster = {
  id: string;
  name: string;
  status: string;
  my_role: { role: string; can_publish: boolean; can_manage_enrollment: boolean } | null;
  leaders: Array<{ profile_id: string; name: string; role: string; effective: boolean }>;
  members: Array<{ child_id: string; display_name: string; participation: string; has_account: boolean; paused: boolean }>;
};
type Options = { memory_collections: Array<{ id: string; title: string }>; reading_plans: Array<{ id: string; title: string }>; resources: Array<{ id: string; title: string; kind: string }> };

export default async function LeadGroupPage({ params, searchParams }: PageProps<"/youth/lead/groups/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireApprovedMember(`/youth/lead/groups/${id}`);
  const q = String((await searchParams).q ?? "").slice(0, 60);
  const { data: r } = await youthRead<Roster>("youth_group_roster", { p_group: id });
  if (!r) return <Alert tone="error" title="This group couldn't be loaded right now." />;
  const canPublish = Boolean(r.my_role?.can_publish);
  const canEnroll = Boolean(r.my_role?.can_manage_enrollment);
  const [candidates, manage, options, group] = await Promise.all([
    canEnroll && q.length >= 2 ? youthRead<Array<{ id: string; display_name: string }>>("youth_enroll_candidates", { p_group: id, p_query: q }) : Promise.resolve({ data: null }),
    canPublish ? youthRead<Announcement[]>("youth_manage_announcements") : Promise.resolve({ data: null }),
    canPublish ? youthRead<Options>("youth_learning_options") : Promise.resolve({ data: null }),
    r.my_role ? youthRead<{ learning: Learning[]; discussions_enabled: boolean; supervised: boolean }>("youth_group", { p_id: id }) : Promise.resolve({ data: null }),
  ]);
  const drafts = (manage.data ?? []).filter((a) => a.group_id === id);

  return (
    <>
      <PageHeader eyebrow={<Link href="/youth/lead" className="hover:underline">Leading</Link>} title={r.name} description={r.my_role ? `You're a ${r.my_role.role} of this group.` : "Youth administration view"} />
      <div className="space-y-10">
        <section aria-labelledby="roster">
          <SectionHeading id="roster" description="Preferred names only. Contact details, dates of birth, and guardians' identities stay with the family office.">
            Roster ({r.members.length})
          </SectionHeading>
          <ul className="space-y-2">
            {r.members.map((m) => (
              <li key={m.child_id} className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-border bg-surface px-4 py-3">
                <span className="font-semibold">{m.display_name}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {m.participation === "paused" ? <Badge tone="neutral">Participation paused</Badge> : null}
                  {m.has_account ? <Badge tone="info">Own account</Badge> : null}
                  {canEnroll ? <YouthForm op="unenroll" hidden={{ group: id, child: m.child_id }} submit="Remove" size="sm" variant="danger-outline" inline pendingText="Removing…" /> : null}
                </span>
              </li>
            ))}
          </ul>
          {canEnroll ? (
            <Card className="mt-4 space-y-3">
              <form className="flex flex-wrap items-end gap-2" role="search">
                <TextField label="Add a child (search by preferred name)" name="q" defaultValue={q} minLength={2} className="min-w-64 flex-1" />
                <button type="submit" className="min-h-12 rounded-full border border-border px-5 font-semibold">
                  Search
                </button>
              </form>
              {(candidates.data ?? []).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span>{c.display_name}</span>
                  <YouthForm op="enroll" hidden={{ group: id, child: c.id }} submit="Add to group" size="sm" inline />
                </div>
              ))}
              {q.length >= 2 && (candidates.data ?? []).length === 0 ? <p className="text-meta text-text-secondary">No matches.</p> : null}
            </Card>
          ) : null}
        </section>

        <section aria-labelledby="leaders">
          <SectionHeading id="leaders">Leaders</SectionHeading>
          <p className="text-text-secondary">{r.leaders.map((l) => `${l.name} (${l.role})${l.effective ? "" : " — role missing"}`).join(", ")}</p>
        </section>

        {r.my_role ? (
          <section aria-labelledby="discuss">
            <SectionHeading id="discuss">Start a supervised discussion</SectionHeading>
            {!group.data?.discussions_enabled ? (
              <p className="text-meta text-text-secondary">Discussions aren&apos;t enabled under the church&apos;s current policy.</p>
            ) : !group.data.supervised ? (
              <p className="text-meta text-text-secondary">This group needs more leaders or at least three enrolled members before discussions can open.</p>
            ) : (
              <Card>
                <YouthForm op="discussion_create" hidden={{ group: id }} submit="Start discussion">
                  <TextField label="Title" name="title" maxLength={160} required />
                  <TextAreaField label="Opening message" name="body" rows={3} maxLength={4000} required />
                  <SelectField label="Kind" name="kind" defaultValue="discussion" hint="Prayer threads appear only when the church's policy allows group prayer.">
                    <option value="discussion">Discussion</option>
                    <option value="prayer">Group prayer</option>
                  </SelectField>
                </YouthForm>
              </Card>
            )}
          </section>
        ) : null}

        {canPublish ? (
          <section aria-labelledby="ann">
            <SectionHeading id="ann">Announcements</SectionHeading>
            <Card>
              <YouthForm op="announcement_save" hidden={{ group: id }} submit="Save draft">
                <TextField label="Title" name="title" maxLength={160} required />
                <TextAreaField label="Message" name="body" rows={4} maxLength={5000} hint="Basic formatting with Markdown. Don't include phone numbers, addresses, or anything about a specific child." />
                <CheckboxField name="to_youth" label="Youth in this group (shown in the Youth area)" defaultChecked />
                <CheckboxField name="to_guardians" label="Verified parents and guardians of youth in this group" defaultChecked hint="They get a notification; email and push only say there's an update." />
              </YouthForm>
            </Card>
            <ul className="mt-4 space-y-2">
              {drafts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-border bg-surface px-4 py-3">
                  <span>
                    <span className="font-semibold">{a.title}</span>{" "}
                    <span className="text-meta text-text-secondary">{a.status === "draft" ? "Draft" : a.status === "published" ? `Published ${formatWhen(a.publish_at)}` : "Archived"}</span>
                  </span>
                  {a.status === "draft" ? <YouthForm op="announcement_publish" hidden={{ id: a.id }} submit="Publish" size="sm" inline /> : null}
                  {a.status === "published" ? <YouthForm op="announcement_archive" hidden={{ id: a.id }} submit="Archive" size="sm" variant="secondary" inline /> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {canPublish && options.data ? (
          <section aria-labelledby="learning">
            <SectionHeading id="learning">Learning for this group</SectionHeading>
            <ul className="mb-4 space-y-2">
              {(group.data?.learning ?? []).map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-border bg-surface px-4 py-3">
                  <span className="font-semibold">{l.title}</span>
                  <YouthForm op="learning_archive" hidden={{ id: l.id }} submit="Remove" size="sm" variant="secondary" inline />
                </li>
              ))}
            </ul>
            <Card>
              <YouthForm op="learning_assign" hidden={{ group: id }} submit="Assign">
                <SelectField label="What to assign" name="ref" defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  <optgroup label="Memory verse collections">
                    {options.data.memory_collections.map((c) => (
                      <option key={c.id} value={`memory_collection:${c.id}`}>
                        {c.title}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Bible reading plans">
                    {options.data.reading_plans.map((c) => (
                      <option key={c.id} value={`reading_plan:${c.id}`}>
                        {c.title}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Lessons and resources">
                    {options.data.resources.map((c) => (
                      <option key={c.id} value={`resource:${c.id}`}>
                        {c.title}
                      </option>
                    ))}
                  </optgroup>
                </SelectField>
                <TextField label="Note (optional)" name="note" maxLength={300} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="From (optional)" name="starts_on" type="date" />
                  <TextField label="Until (optional)" name="ends_on" type="date" />
                </div>
              </YouthForm>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
