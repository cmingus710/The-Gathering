import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CheckboxField, SelectField } from "@/components/ui/field";
import { Attendees, type YouthEventAdmin } from "@/components/youth/attendees";
import { YouthForm } from "@/components/youth/youth-form";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Youth event" };

type Group = { id: string; name: string; status: string };
type Form = { id: string; title: string; status: string; current_version: number | null };

export default async function AdminYouthEventPage({ params }: PageProps<"/admin/youth/events/[series]">) {
  const { series } = await params;
  if (!isUuid(series)) notFound();
  await requireAnyCapability([CAPABILITIES.youthForms, CAPABILITIES.youthManage], `/admin/youth/events/${series}`);
  const [{ data: e }, { data: groups }, { data: forms }, { data: personnel }] = await Promise.all([
    youthRead<YouthEventAdmin>("youth_event_admin", { p_series: series }),
    youthRead<Group[]>("youth_admin_groups"),
    youthRead<Form[]>("youth_admin_forms"),
    youthRead<Array<{ id: string; name: string; designated: boolean }>>("youth_admin_personnel_candidates", { p_series: series }),
  ]);
  if (!e) return <Alert tone="error" title="This event couldn't be loaded right now." />;
  const s = e.settings;
  const required = new Set(e.forms.map((f) => f.form_id));
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/youth/events" className="hover:underline">Youth events</Link>}
        title={e.title}
        description={`${e.status === "draft" ? "Draft" : e.status === "published" ? "Published" : e.status} · capacity ${e.capacity ?? "unlimited"}${e.waitlist_enabled ? " with waitlist" : ""}. Dates, capacity, and deadlines are edited under Administration → Events.`}
      />
      <div className="space-y-10">
        <section aria-labelledby="settings">
          <SectionHeading id="settings">{s ? "Youth settings" : "Make this a youth event"}</SectionHeading>
          <Card>
            <YouthForm op="event_set" hidden={{ series }} submit={s ? "Save settings" : "Make youth-only"}>
              <SelectField label="Youth group" name="group" defaultValue={s?.group_id ?? ""} hint="Only verified guardians of children in this group, its leaders, its youth, and designated personnel can see the event.">
                <option value="" disabled>
                  Choose…
                </option>
                {(groups ?? []).filter((g) => g.status === "active").map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
              <fieldset className="space-y-2">
                <legend className="font-semibold">Required permission forms</legend>
                {(forms ?? []).filter((f) => f.status === "active" && f.current_version).map((f) => (
                  <CheckboxField key={f.id} id={`form-${f.id}`} name="form_ids" value={f.id} label={`${f.title} (version ${f.current_version})`} defaultChecked={required.has(f.id)} />
                ))}
                {(forms ?? []).length === 0 ? <p className="text-meta text-text-secondary">Forms are managed by permission form administrators.</p> : null}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="font-semibold">Collect only what this event needs</legend>
                <CheckboxField name="collect_emergency_contact" label="Emergency contact (required to register)" defaultChecked={s?.collect_emergency_contact} />
                <CheckboxField name="collect_pickup" label="Pickup instructions (optional for families)" defaultChecked={s?.collect_pickup} />
                <CheckboxField name="collect_accommodation" label="Anything families choose to share (optional)" defaultChecked={s?.collect_accommodation} hint="Not medical records." />
              </fieldset>
              <CheckboxField
                name="youth_rsvp"
                label="Independent youth may register themselves"
                defaultChecked={s?.youth_rsvp}
                hint="Also needs the church policy, and only works when no forms or details are required."
              />
            </YouthForm>
            {s && e.status === "draft" ? (
              <YouthForm op="event_unset" hidden={{ series }} submit="Make it a members event again" size="sm" variant="secondary" inline className="mt-4" />
            ) : null}
          </Card>
        </section>

        {s ? (
          <section aria-labelledby="personnel">
            <SectionHeading id="personnel" description="Only these people see emergency contacts and pickup notes, and each viewing is recorded.">
              Event personnel
            </SectionHeading>
            <Card className="space-y-2">
              {(personnel ?? []).map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{p.name}</span>
                  <YouthForm
                    op="personnel"
                    hidden={{ series, profile: p.id, on: p.designated ? "false" : "true" }}
                    submit={p.designated ? "Remove" : "Designate"}
                    size="sm"
                    variant={p.designated ? "danger-outline" : "secondary"}
                    inline
                  />
                </div>
              ))}
              {(personnel ?? []).length === 0 ? <p className="text-meta text-text-secondary">Leaders of the group and holders of the Youth event logistics role appear here.</p> : null}
            </Card>
          </section>
        ) : null}

        {s ? (
          <section aria-labelledby="attendees">
            <SectionHeading id="attendees">Attendees and consent</SectionHeading>
            <Attendees event={e} />
          </section>
        ) : null}
      </div>
    </>
  );
}
