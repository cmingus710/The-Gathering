import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { TextAreaField, TextField } from "@/components/ui/field";
import { YouthForm } from "@/components/youth/youth-form";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Youth groups" };

type Row = { id: string; name: string; description: string; status: string; leaders: number; enrolled: number };

export default async function GroupsPage() {
  const viewer = await requireAnyCapability([CAPABILITIES.youthManage, CAPABILITIES.youthEnroll, CAPABILITIES.youthPublish], "/admin/youth/groups");
  const { data, failed } = await youthRead<Row[]>("youth_admin_groups");
  return (
    <>
      <PageHeader title="Youth groups" description="Separate from community groups: no open rosters, join requests, or messaging. Every active group keeps at least one leader." />
      {failed || !data ? <Alert tone="error" title="Groups couldn't be loaded right now." /> : null}
      <div className="space-y-8">
        <div className={rowListClass}>
          {(data ?? []).map((g) => (
            <ListRow
              key={g.id}
              plain
              href={`/admin/youth/groups/${g.id}`}
              label={g.name}
              description={`${g.leaders} leader${g.leaders === 1 ? "" : "s"} · ${g.enrolled} enrolled`}
              trailing={g.status === "archived" ? <Badge tone="neutral">Archived</Badge> : undefined}
            />
          ))}
        </div>
        {viewer.capabilities.has(CAPABILITIES.youthManage) ? (
          <section aria-labelledby="new">
            <SectionHeading id="new">New group</SectionHeading>
            <Card>
              <YouthForm op="group_save" submit="Create group">
                <TextField label="Name" name="name" maxLength={80} required />
                <TextAreaField label="Description" name="description" rows={2} maxLength={1000} optional />
              </YouthForm>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
