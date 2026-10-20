import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { YouthForm } from "@/components/youth/youth-form";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Youth group" };

type Roster = {
  id: string;
  name: string;
  description: string;
  status: string;
  leaders: Array<{ profile_id: string; name: string; role: string; can_publish: boolean; can_manage_enrollment: boolean; effective: boolean }>;
  members: Array<{ child_id: string; display_name: string; participation: string; has_account: boolean }>;
};

export default async function AdminGroupPage({ params, searchParams }: PageProps<"/admin/youth/groups/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const viewer = await requireAnyCapability([CAPABILITIES.youthManage, CAPABILITIES.youthEnroll], `/admin/youth/groups/${id}`);
  const sp = await searchParams;
  const q = String(sp.q ?? "").slice(0, 60);
  const lq = String(sp.lq ?? "").slice(0, 60);
  const manage = viewer.capabilities.has(CAPABILITIES.youthManage);
  const enroll = viewer.capabilities.has(CAPABILITIES.youthEnroll);
  const [{ data: r }, candidates, leaders] = await Promise.all([
    youthRead<Roster>("youth_group_roster", { p_group: id }),
    enroll && q.length >= 2 ? youthRead<Array<{ id: string; display_name: string }>>("youth_enroll_candidates", { p_group: id, p_query: q }) : Promise.resolve({ data: null }),
    manage ? youthRead<Array<{ id: string; name: string }>>("youth_admin_leader_candidates", { p_query: lq || null }) : Promise.resolve({ data: null }),
  ]);
  if (!r) return <Alert tone="error" title="This group couldn't be loaded right now." />;
  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/youth/groups" className="hover:underline">Youth groups</Link>} title={r.name} description={r.status === "archived" ? "Archived" : undefined} />
      <div className="space-y-10">
        {manage ? (
          <section aria-labelledby="details">
            <SectionHeading id="details">Details</SectionHeading>
            <Card className="space-y-4">
              {r.status === "active" ? (
                <YouthForm op="group_save" hidden={{ id: r.id }} submit="Save">
                  <TextField label="Name" name="name" defaultValue={r.name} maxLength={80} required />
                  <TextAreaField label="Description" name="description" defaultValue={r.description} rows={2} maxLength={1000} optional />
                </YouthForm>
              ) : null}
              <YouthForm
                op="group_archive"
                hidden={{ id: r.id, on: r.status === "active" ? "true" : "false" }}
                submit={r.status === "active" ? "Archive group" : "Restore group"}
                variant={r.status === "active" ? "danger-outline" : "secondary"}
                size="sm"
                inline
              />
              {r.status === "active" ? <p className="text-meta text-text-secondary">Archiving closes discussions and keeps history. To remove the last leader, assign another first or archive.</p> : null}
            </Card>
          </section>
        ) : null}

        <section aria-labelledby="leaders">
          <SectionHeading id="leaders">Leaders</SectionHeading>
          <ul className="space-y-3">
            {r.leaders.map((l) => (
              <li key={l.profile_id}>
                <Card className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{l.name}</span>
                    <span className="flex gap-1.5">
                      <Badge tone="neutral">{l.role === "helper" ? "Helper" : "Leader"}</Badge>
                      {!l.effective ? <Badge tone="danger">Youth leader role missing</Badge> : null}
                    </span>
                  </div>
                  {manage ? (
                    <>
                      <YouthForm op="leader_set" hidden={{ group: r.id, profile: l.profile_id, status: "active" }} submit="Save" size="sm">
                        <SelectField id={`role-${l.profile_id}`} label="Role" name="role" defaultValue={l.role}>
                          <option value="leader">Leader</option>
                          <option value="helper">Helper</option>
                        </SelectField>
                        <CheckboxField id={`pub-${l.profile_id}`} name="can_publish" label="Can publish announcements and learning" defaultChecked={l.can_publish} />
                        <CheckboxField id={`enr-${l.profile_id}`} name="can_manage_enrollment" label="Can add and remove children" defaultChecked={l.can_manage_enrollment} />
                      </YouthForm>
                      <YouthForm op="leader_set" hidden={{ group: r.id, profile: l.profile_id, status: "removed" }} submit="Remove from group" size="sm" variant="danger-outline" inline />
                    </>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
          {manage ? (
            <Card className="mt-4 space-y-3">
              <form role="search" className="flex flex-wrap items-end gap-2">
                <TextField label="Find someone with the Youth leader role" name="lq" defaultValue={lq} className="min-w-64 flex-1" />
                <button type="submit" className="min-h-12 rounded-full border border-border px-5 font-semibold">
                  Search
                </button>
              </form>
              {(leaders.data ?? []).filter((c) => !r.leaders.some((l) => l.profile_id === c.id)).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span>{c.name}</span>
                  <YouthForm op="leader_set" hidden={{ group: r.id, profile: c.id, status: "active", role: "leader" }} submit="Add as leader" size="sm" inline />
                </div>
              ))}
              <p className="text-meta text-text-secondary">Only approved adults with the Youth leader role (Administration → Members) appear here.</p>
            </Card>
          ) : null}
        </section>

        <section aria-labelledby="roster">
          <SectionHeading id="roster">Enrolled ({r.members.length})</SectionHeading>
          <ul className="space-y-2">
            {r.members.map((m) => (
              <li key={m.child_id} className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-border bg-surface px-4 py-3">
                <span className="font-semibold">{m.display_name}</span>
                {enroll ? <YouthForm op="unenroll" hidden={{ group: r.id, child: m.child_id }} submit="Remove" size="sm" variant="danger-outline" inline /> : null}
              </li>
            ))}
          </ul>
          {enroll ? (
            <Card className="mt-4 space-y-3">
              <form role="search" className="flex flex-wrap items-end gap-2">
                <TextField label="Add a child (search by preferred name)" name="q" defaultValue={q} className="min-w-64 flex-1" />
                <button type="submit" className="min-h-12 rounded-full border border-border px-5 font-semibold">
                  Search
                </button>
              </form>
              {(candidates.data ?? []).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span>{c.display_name}</span>
                  <YouthForm op="enroll" hidden={{ group: r.id, child: c.id }} submit="Enroll" size="sm" inline />
                </div>
              ))}
            </Card>
          ) : null}
        </section>
      </div>
    </>
  );
}
