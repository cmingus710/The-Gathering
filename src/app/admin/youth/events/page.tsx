import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { formatDay, formatWhen } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Youth events" };

type Row = { series_id: string; title: string; status: string; audience: string; start_date: string; youth: boolean; group: string | null; forms: number; next: string | null };

export default async function YouthEventsPage() {
  await requireAnyCapability([CAPABILITIES.youthForms, CAPABILITIES.youthManage], "/admin/youth/events");
  const { data, failed } = await youthRead<Row[]>("youth_admin_events");
  const youth = (data ?? []).filter((e) => e.youth);
  const drafts = (data ?? []).filter((e) => !e.youth);
  return (
    <>
      <PageHeader
        title="Youth events"
        description="Youth events are ordinary events (Administration → Events) made youth-only here: one youth group, required permission forms, any event-specific details to collect, and the personnel who may see those details."
      />
      {failed ? <Alert tone="error" title="Events couldn't be loaded right now." /> : null}
      <div className="space-y-8">
        <section aria-labelledby="youth">
          <SectionHeading id="youth">Youth events</SectionHeading>
          <div className={rowListClass}>
            {youth.map((e) => (
              <ListRow
                key={e.series_id}
                plain
                href={`/admin/youth/events/${e.series_id}`}
                label={e.title}
                description={`${e.group ?? "No group"} · ${e.next ? formatWhen(e.next) : formatDay(e.start_date)} · ${e.forms} form${e.forms === 1 ? "" : "s"}`}
                trailing={<Badge tone={e.status === "published" ? "success" : "neutral"}>{e.status === "published" ? "Published" : e.status === "draft" ? "Draft" : "Canceled"}</Badge>}
              />
            ))}
          </div>
          {youth.length === 0 ? <p className="text-meta text-text-secondary">No youth events yet.</p> : null}
        </section>
        <section aria-labelledby="drafts">
          <SectionHeading id="drafts" description="Only drafts without member registrations can become youth events.">
            Draft events
          </SectionHeading>
          <div className={rowListClass}>
            {drafts.map((e) => (
              <ListRow key={e.series_id} plain href={`/admin/youth/events/${e.series_id}`} label={e.title} description={formatDay(e.start_date)} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
