import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/field";
import { StateBadge } from "@/components/youth/state-badge";
import { YouthForm } from "@/components/youth/youth-form";
import { renderAnnouncementMarkdown } from "@/lib/announcements/markdown";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { CANCEL_REASONS, CONSENT_STATE, REGISTRATION_STATUS, formatWhen, type Permissions } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";
import type { ChildEvent } from "@/lib/youth/types";

export const metadata: Metadata = { title: "Youth event" };

type Detail = ChildEvent & {
  description: string;
  location_address: string | null;
  cancellation_instructions: string | null;
  organizer_name: string | null;
  child: { id: string; display_name: string };
  permissions: Permissions;
  logistics: { emergency_name: string | null; emergency_phone: string | null; pickup_note: string | null; accommodation_note: string | null; updated_at: string } | null;
};

type Version = { id: string; title: string; version: number; body: string; statement: string; change_summary: string };

export default async function ChildEventPage({ params }: PageProps<"/youth/family/children/[id]/events/[occurrence]">) {
  const { id, occurrence } = await params;
  if (!isUuid(id) || !isUuid(occurrence)) notFound();
  await requireApprovedMember(`/youth/family/children/${id}/events/${occurrence}`);
  const { data: e } = await youthRead<Detail>("youth_child_event", { p_occurrence: occurrence, p_child: id });
  if (!e) return <Alert tone="error" title="This event couldn't be loaded right now." />;
  const versions = await Promise.all(
    e.forms.map((f) => (f.version_id ? youthRead<Version>("youth_form_version", { p_version: f.version_id }).then((r) => r.data) : Promise.resolve(null))),
  );
  const reg = e.registration && e.registration.status !== "canceled" ? e.registration : null;
  const collects = e.collects.emergency_contact || e.collects.pickup || e.collects.accommodation;
  const closed = !e.registration_open;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/youth/family/children/${id}`} className="hover:underline">{e.child.display_name}</Link>}
        title={e.title}
        description={`${formatWhen(e.starts_at, e.timezone)}${e.location_name ? ` · ${e.location_name}` : ""}${e.group ? ` · ${e.group}` : ""}`}
      />
      <div className="space-y-10">
        {e.status === "canceled" ? <Alert tone="warning" title="This event was canceled." /> : null}
        {e.description ? (
          <Card>
            <div className="prose-gathering break-words" dangerouslySetInnerHTML={{ __html: renderAnnouncementMarkdown(e.description) }} />
            {e.location_address ? <p className="mt-3 text-meta text-text-secondary">{e.location_address}</p> : null}
          </Card>
        ) : null}

        {e.forms.length ? (
          <section aria-labelledby="forms">
            <SectionHeading id="forms" description="Each form records your decision for this event only.">
              Permission forms
            </SectionHeading>
            <div className="space-y-4">
              {e.forms.map((f, i) => {
                const v = versions[i];
                return (
                  <Card key={f.form_id} className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[1.125rem] font-semibold">
                        {f.title} <span className="text-meta font-normal text-text-secondary">(version {f.version})</span>
                      </h3>
                      <StateBadge map={CONSENT_STATE} value={f.state} />
                    </div>
                    <p className="text-meta text-text-secondary">{CONSENT_STATE[f.state]?.help}</p>
                    {v ? (
                      <details className="rounded-tile border border-border px-4 py-3" open={f.state !== "granted"}>
                        <summary className="min-h-11 cursor-pointer font-semibold">Read the form</summary>
                        <div className="mt-2 whitespace-pre-wrap">{v.body}</div>
                        {v.change_summary ? <p className="mt-2 text-meta text-text-secondary">What changed: {v.change_summary}</p> : null}
                      </details>
                    ) : null}
                    {e.permissions.sign_forms && v ? (
                      f.state === "granted" && f.consent_id ? (
                        <YouthForm op="consent_withdraw" hidden={{ id: f.consent_id }} submit="Withdraw permission" variant="danger-outline" size="sm" inline pendingText="Withdrawing…" />
                      ) : (
                        <YouthForm
                          op="consent"
                          hidden={{ series: e.series_id, child: id, version: v.id }}
                          submit="Give permission"
                          extraButtons={null}
                          className="space-y-3"
                        >
                          <input type="hidden" name="decision" value="granted" />
                          <CheckboxField id={`agree-${f.form_id}`} name="agree" label={v.statement} required />
                          <p className="text-meta text-text-secondary">
                            Checking this records your agreement as a verified guardian, with the date and this form version. It isn&apos;t a legally verified
                            signature.
                          </p>
                        </YouthForm>
                      )
                    ) : null}
                    {e.permissions.sign_forms && v && f.state !== "declined" && f.state !== "granted" ? (
                      <YouthForm op="consent" hidden={{ series: e.series_id, child: id, version: v.id, decision: "declined" }} submit="Decline" variant="secondary" size="sm" inline />
                    ) : null}
                  </Card>
                );
              })}
            </div>
          </section>
        ) : null}

        {collects && e.permissions.register ? (
          <section aria-labelledby="logistics">
            <SectionHeading id="logistics" description="Seen only by the people staffing this event. Never in the event description, rosters, calendar feeds, or notifications.">
              Details for this event
            </SectionHeading>
            <Card>
              <YouthForm op="logistics" hidden={{ series: e.series_id, child: id }} submit="Save details">
                {e.collects.emergency_contact ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Emergency contact name" name="emergency_name" defaultValue={e.logistics?.emergency_name ?? ""} maxLength={120} required autoComplete="off" />
                    <TextField label="Emergency contact phone" name="emergency_phone" type="tel" defaultValue={e.logistics?.emergency_phone ?? ""} maxLength={40} required autoComplete="off" />
                  </div>
                ) : null}
                {e.collects.pickup ? (
                  <TextAreaField
                    label="Pickup instructions"
                    name="pickup_note"
                    defaultValue={e.logistics?.pickup_note ?? ""}
                    maxLength={500}
                    rows={2}
                    optional
                    hint="For example, who usually collects them. This doesn't authorize anyone to pick up your child; check-in and pickup follow the church's own procedures."
                  />
                ) : null}
                {e.collects.accommodation ? (
                  <TextAreaField
                    label="Anything that would help (optional)"
                    name="accommodation_note"
                    defaultValue={e.logistics?.accommodation_note ?? ""}
                    maxLength={500}
                    rows={2}
                    optional
                    hint="Only what you choose to share for this event. Please don't include medical records."
                  />
                ) : null}
              </YouthForm>
            </Card>
          </section>
        ) : null}

        <section aria-labelledby="register">
          <SectionHeading id="register">Registration</SectionHeading>
          <Card className="space-y-3">
            {reg ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge map={REGISTRATION_STATUS} value={reg.status} />
                  {reg.position ? <span className="text-meta text-text-secondary">Number {reg.position} on the waitlist</span> : null}
                </div>
                {e.permissions.register ? (
                  <YouthForm op="cancel" hidden={{ occurrence, child: id }} submit="Cancel registration" variant="danger-outline" size="sm" inline pendingText="Canceling…" />
                ) : null}
              </>
            ) : (
              <>
                {e.registration?.status === "canceled" && e.registration.cancel_reason ? (
                  <p className="text-meta text-text-secondary">{CANCEL_REASONS[e.registration.cancel_reason]}</p>
                ) : null}
                {!e.rsvp_enabled ? (
                  <p className="text-text-secondary">This event doesn&apos;t take registrations.</p>
                ) : closed ? (
                  <p className="text-text-secondary">Registration has closed.</p>
                ) : e.permissions.register ? (
                  <YouthForm op="register" hidden={{ occurrence, child: id }} submit={`Register ${e.child.display_name}`} pendingText="Registering…" />
                ) : (
                  <p className="text-text-secondary">Another guardian handles registration for {e.child.display_name}.</p>
                )}
              </>
            )}
            {e.cancellation_instructions ? <p className="text-meta text-text-secondary">{e.cancellation_instructions}</p> : null}
          </Card>
        </section>
      </div>
    </>
  );
}
