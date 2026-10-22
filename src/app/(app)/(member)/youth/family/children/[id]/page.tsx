import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { EventList } from "@/components/youth/sections";
import { StateBadge } from "@/components/youth/state-badge";
import { YouthForm } from "@/components/youth/youth-form";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { CONSENT_STATE, MEDIA_STATE, PERMISSIONS, RELATIONSHIPS, formatDay, formatWhen, type Permissions } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";
import type { ChildEvent, GroupRef } from "@/lib/youth/types";

export const metadata: Metadata = { title: "Child" };

type Child = {
  id: string;
  display_name: string;
  participation: string;
  groups: GroupRef[];
  account_linked: boolean;
  relationship: string;
  permissions: Permissions;
  other_guardians: number;
  birth_date: string | null;
  birth_date_collected: boolean;
  account: {
    linked: boolean;
    active?: boolean;
    policy_allows?: boolean;
    guardian_authorization_required?: boolean;
    eligible?: boolean;
    invitation?: { id: string; email: string; expires_at: string; guardian_authorized: boolean } | null;
    sharing?: boolean | null;
  };
};

type Media = {
  member_gallery: string;
  public_use: string;
  public_use_offered: boolean;
  decisions: Array<{ id: string; scope: string; decision: string; decided_at: string; withdrawn_at: string | null; mine: boolean; event: string | null }>;
};

type Progress = { independent: boolean; shared: boolean; verses_practiced?: number; review_ready?: number; days_practiced_28?: number; activities_7?: number; badges?: string[]; reading_days_28?: number };

export default async function ChildPage({ params }: PageProps<"/youth/family/children/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireApprovedMember(`/youth/family/children/${id}`);
  const { data: c } = await youthRead<Child>("youth_family_child", { p_child: id });
  if (!c) return <Alert tone="error" title="This page couldn't be loaded right now." />;
  const p = c.permissions;
  const [events, media, progress] = await Promise.all([
    p.register || p.sign_forms || p.receive_updates ? youthRead<ChildEvent[]>("youth_child_events", { p_child: id }) : Promise.resolve({ data: null }),
    p.media_consent ? youthRead<Media>("youth_child_media", { p_child: id }) : Promise.resolve({ data: null }),
    p.view_progress ? youthRead<Progress>("youth_child_progress", { p_child: id }) : Promise.resolve({ data: null }),
  ]);
  const granted = PERMISSIONS.filter((x) => p[x.key]);

  return (
    <>
      <BackLink route="/youth/family/children/[id]" />
      <PageHeader
        title={c.display_name}
        description={`${RELATIONSHIPS[c.relationship] ?? c.relationship}${c.groups.length ? ` · ${c.groups.map((g) => g.name).join(", ")}` : ""}`}
        actions={p.practice && !c.account_linked ? <ButtonLink href={`/youth/family/children/${id}/practice`}>Practice verses together</ButtonLink> : undefined}
      />
      <div className="space-y-10">
        <section aria-labelledby="access">
          <SectionHeading id="access">What you can do for {c.display_name}</SectionHeading>
          <Card className="space-y-3">
            <ul className="flex flex-wrap gap-1.5">
              {granted.map((g) => (
                <li key={g.key}>
                  <Badge tone="success">{g.label}</Badge>
                </li>
              ))}
            </ul>
            <p className="text-meta text-text-secondary">
              The church office chose these permissions when it verified you. {c.other_guardians > 0 ? `${c.other_guardians} other verified ${c.other_guardians === 1 ? "guardian" : "guardians"} may have different permissions. ` : ""}
              Youth leaders of {c.display_name}&apos;s groups see their preferred name and participation, never your contact details or their date of birth.
            </p>
          </Card>
        </section>

        {p.manage_profile ? (
          <section aria-labelledby="profile">
            <SectionHeading id="profile">Profile</SectionHeading>
            <Card>
              <YouthForm op="child_save" hidden={{ child: id, has_birth_date: c.birth_date_collected ? "1" : "0" }} submit="Save profile">
                <TextField label="Preferred name" name="display_name" defaultValue={c.display_name} maxLength={60} required />
                <SelectField label="Participation" name="participation" defaultValue={c.participation} hint="Paused keeps their groups but stops new event registrations.">
                  <option value="active">Taking part</option>
                  <option value="paused">Paused for now</option>
                </SelectField>
                {c.birth_date_collected ? (
                  <TextField label="Date of birth" name="birth_date" type="date" defaultValue={c.birth_date ?? ""} optional hint="Private: used only to confirm eligibility under the church's policy. Never in rosters, searches, logs, or notifications." />
                ) : null}
              </YouthForm>
            </Card>
          </section>
        ) : null}

        <section aria-labelledby="groups">
          <SectionHeading id="groups">Groups</SectionHeading>
          {c.groups.length === 0 ? (
            <p className="text-meta text-text-secondary">Not in a youth group yet. Leaders or the youth office add children to groups.</p>
          ) : (
            <ul className="space-y-2">
              {c.groups.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-border bg-surface px-4 py-3">
                  <a href={`/youth/groups/${g.id}`} className="font-semibold hover:underline">
                    {g.name}
                  </a>
                  {p.manage_profile ? (
                    <YouthForm op="leave_group" hidden={{ group: g.id, child: id }} submit="Remove from group" variant="danger-outline" size="sm" inline pendingText="Removing…" />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {events.data ? (
          <section aria-labelledby="events">
            <SectionHeading id="events">Events</SectionHeading>
            <EventList
              items={events.data}
              empty="No upcoming events for their groups."
              hrefFor={(e) => `/youth/family/children/${id}/events/${e.occurrence_id}`}
              render={(e) =>
                e.forms.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {e.forms.map((f) => (
                      <li key={f.form_id}>
                        <span className="sr-only">{f.title}: </span>
                        <StateBadge map={CONSENT_STATE} value={f.state} />
                      </li>
                    ))}
                  </ul>
                ) : null
              }
            />
          </section>
        ) : null}

        {media.data ? (
          <section aria-labelledby="photos">
            <SectionHeading id="photos" description="Photos are only ever shown inside the app to members or a group. Nothing here allows public use unless you decide that separately.">
              Photo consent
            </SectionHeading>
            <Card className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Member and group galleries:</span>
                <StateBadge map={MEDIA_STATE} value={media.data.member_gallery} />
              </div>
              <p className="text-meta text-text-secondary">{MEDIA_STATE[media.data.member_gallery]?.help}</p>
              <div className="flex flex-wrap gap-2">
                <YouthForm op="media_consent" hidden={{ child: id, scope: "member_gallery", decision: "granted" }} submit="Allow in member galleries" size="sm" inline />
                <YouthForm op="media_consent" hidden={{ child: id, scope: "member_gallery", decision: "declined" }} submit="Don't allow" size="sm" variant="secondary" inline />
              </div>
              <div className="border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Public use (websites, social media, banners):</span>
                  <StateBadge map={MEDIA_STATE} value={media.data.public_use} />
                </div>
                {media.data.public_use_offered ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <YouthForm op="media_consent" hidden={{ child: id, scope: "public_use", decision: "granted" }} submit="Allow public use" size="sm" variant="secondary" inline />
                    <YouthForm op="media_consent" hidden={{ child: id, scope: "public_use", decision: "declined" }} submit="Don't allow public use" size="sm" variant="secondary" inline />
                  </div>
                ) : (
                  <p className="mt-1 text-meta text-text-secondary">Not offered: the church doesn&apos;t use children&apos;s photos publicly.</p>
                )}
              </div>
              {media.data.decisions.length ? (
                <div className="border-t border-border pt-4">
                  <h3 className="font-semibold">History</h3>
                  <ul className="mt-2 space-y-2">
                    {media.data.decisions.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-meta">
                        <span>
                          {d.scope === "public_use" ? "Public use" : "Member galleries"}
                          {d.event ? ` (${d.event})` : ""}: {d.decision === "granted" ? "allowed" : "not allowed"} {formatDay(d.decided_at)} by {d.mine ? "you" : "another guardian"}
                          {d.withdrawn_at ? `, withdrawn ${formatDay(d.withdrawn_at)}` : ""}
                        </span>
                        {!d.withdrawn_at && d.decision === "granted" ? (
                          <YouthForm op="media_withdraw" hidden={{ id: d.id }} submit="Withdraw" size="sm" variant="danger-outline" inline pendingText="Withdrawing…" />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-meta text-text-secondary">
                Withdrawing hides published photos that staff have linked to {c.display_name} and sends them for review. It can&apos;t recall screenshots or
                copies people already saved. Staff link photos to children by hand; nothing in the app recognizes faces.
              </p>
            </Card>
          </section>
        ) : null}

        {progress.data ? (
          <section aria-labelledby="progress">
            <SectionHeading id="progress">Memory verse progress</SectionHeading>
            <Card>
              {progress.data.shared ? (
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-meta text-text-secondary">Verses practiced</dt>
                    <dd className="text-[1.5rem] font-semibold">{progress.data.verses_practiced ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-meta text-text-secondary">Ready for review</dt>
                    <dd className="text-[1.5rem] font-semibold">{progress.data.review_ready ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-meta text-text-secondary">Days practiced (last 4 weeks)</dt>
                    <dd className="text-[1.5rem] font-semibold">{progress.data.days_practiced_28 ?? 0}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-text-secondary">
                  {c.display_name} has their own account and hasn&apos;t chosen to share a progress summary. Their answers, journal, and reflections are always private.
                </p>
              )}
              {progress.data.shared && progress.data.independent ? (
                <p className="mt-3 text-meta text-text-secondary">Shared by {c.display_name}. A summary only: never answers, journal entries, or reflections.</p>
              ) : null}
            </Card>
          </section>
        ) : null}

        {p.manage_account ? (
          <section aria-labelledby="account">
            <SectionHeading id="account">Their own account</SectionHeading>
            <Card className="space-y-4">
              {c.account.linked ? (
                <>
                  <p>
                    {c.display_name} signs in with their own account{c.account.active ? "" : " (not active right now)"}. You can&apos;t sign in as them, and they
                    can&apos;t see your account.
                  </p>
                  <p className="text-meta text-text-secondary">
                    Progress sharing: {c.account.sharing ? "they share a summary with guardians" : "off (their choice)"}.
                  </p>
                </>
              ) : !c.account.policy_allows ? (
                <p className="text-text-secondary">Independent youth accounts aren&apos;t available under the church&apos;s current policy.</p>
              ) : !c.account.eligible ? (
                <p className="text-text-secondary">The church office hasn&apos;t confirmed eligibility for an independent account under the current policy.</p>
              ) : c.account.invitation ? (
                <div className="space-y-3">
                  <p>
                    Invitation open for <strong>{c.account.invitation.email}</strong> until {formatWhen(c.account.invitation.expires_at)}.
                  </p>
                  {c.account.invitation.guardian_authorized ? (
                    <Badge tone="success">Authorized by a verified guardian</Badge>
                  ) : (
                    <YouthForm op="authorize" hidden={{ invitation: c.account.invitation.id }} submit="Authorize this account" size="sm" inline />
                  )}
                  <YouthForm op="invite_revoke" hidden={{ invitation: c.account.invitation.id }} submit="Revoke invitation" size="sm" variant="danger-outline" inline />
                </div>
              ) : (
                <YouthForm op="invite" hidden={{ child: id }} submit="Create invitation code" pendingText="Creating…">
                  <TextField
                    label="The youth's own email address"
                    name="email"
                    type="email"
                    autoComplete="off"
                    required
                    hint="They sign up with this email and confirm it from their inbox, then enter the code. It can't be an address that already has an account here, or yours."
                  />
                  <p className="text-meta text-text-secondary">
                    Creating the code also records your authorization as a verified guardian. No email is sent by the app.
                  </p>
                </YouthForm>
              )}
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
