import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { PermissionFields } from "@/components/youth/permission-fields";
import { StateBadge } from "@/components/youth/state-badge";
import { YouthForm } from "@/components/youth/youth-form";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { GUARDIAN_STATUS, RELATIONSHIPS, RESTRICTION_REASONS, VERIFICATION_METHODS, formatDay, formatWhen, type Permissions } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Child profile" };

type AdminChild = {
  id: string;
  display_name: string;
  participation: string;
  status: string;
  restricted: boolean;
  restricted_reason: string | null;
  birth_date: string | null;
  account: { linked_at: string; name: string; active: boolean; status: string } | null;
  eligibility: { independent_account: boolean; determined_at: string; determined_by: string } | null;
  policy_version: number | null;
  guardians: Array<{ id: string; name: string; relationship: string; status: string; permissions: Permissions; verification_method: string | null; verified_at: string | null; verified_by: string | null; member_active: boolean }>;
  groups: Array<{ id: string; name: string; status: string }>;
  invitations: Array<{ id: string; email: string; status: string; created_at: string; expires_at: string; guardian_authorized: boolean }>;
  transition: { id: string; status: string; started_at: string; youth_confirmed_at: string | null } | null;
  history: Array<{ action: string; from: string | null; to: string | null; fields: string[]; at: string; by: string | null }>;
};

export default async function AdminChildPage({ params }: PageProps<"/admin/youth/families/children/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireCapability(CAPABILITIES.familyVerify, `/admin/youth/families/children/${id}`);
  const [{ data: c }, { data: policy }] = await Promise.all([
    youthRead<AdminChild>("youth_admin_child", { p_id: id }),
    youthRead<{ approved: boolean; settings: Record<string, unknown> }>("youth_policy"),
  ]);
  if (!c) return <Alert tone="error" title="This child profile couldn't be loaded right now." />;
  const s = policy?.settings ?? {};
  const openInvite = c.invitations.find((i) => i.status === "pending");
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/youth/families" className="hover:underline">Families and guardians</Link>}
        title={c.display_name}
        description="Opening this page is recorded (it shows private eligibility data)."
      />
      <div className="space-y-10">
        {c.restricted ? (
          <Alert tone="warning" title={`Restricted: ${RESTRICTION_REASONS[c.restricted_reason ?? "other"]}`}>
            Every guardian and youth-account path is paused. Guardians see only that access is paused.
          </Alert>
        ) : null}

        <section aria-labelledby="profile">
          <SectionHeading id="profile">Profile</SectionHeading>
          <Card>
            <YouthForm op="admin_child_save" hidden={{ id: c.id, has_birth_date: s.birth_date_required ? "1" : "0" }} submit="Save">
              <TextField label="Preferred name" name="display_name" defaultValue={c.display_name} maxLength={60} required />
              <SelectField label="Participation" name="participation" defaultValue={c.participation}>
                <option value="active">Taking part</option>
                <option value="paused">Paused</option>
              </SelectField>
              {s.birth_date_required ? (
                <TextField label="Date of birth" name="birth_date" type="date" defaultValue={c.birth_date ?? ""} optional />
              ) : c.birth_date ? (
                <p className="text-meta text-text-secondary">A date of birth is on file from an earlier policy. The current policy doesn&apos;t collect one.</p>
              ) : null}
            </YouthForm>
          </Card>
        </section>

        <section aria-labelledby="guardians">
          <SectionHeading id="guardians">Guardians</SectionHeading>
          <div className="space-y-4">
            {c.guardians.map((g) => (
              <Card key={g.id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">
                    {g.name} <span className="font-normal text-text-secondary">({RELATIONSHIPS[g.relationship]})</span>
                  </h3>
                  <span className="flex gap-1.5">
                    <StateBadge map={GUARDIAN_STATUS} value={g.status} />
                    {!g.member_active ? <Badge tone="danger">Membership not active</Badge> : null}
                  </span>
                </div>
                {g.verified_at ? (
                  <p className="text-meta text-text-secondary">
                    {VERIFICATION_METHODS[g.verification_method ?? "other"]} · verified {formatDay(g.verified_at)}
                    {g.verified_by ? ` by ${g.verified_by}` : ""}
                  </p>
                ) : null}
                {g.status === "verified" || g.status === "suspended" ? (
                  <YouthForm op="guardian_update" hidden={{ id: g.id, status: g.status }} submit="Save permissions" size="sm">
                    <input type="hidden" name="verification_method" value={g.verification_method ?? ""} />
                    <PermissionFields current={g.permissions} idPrefix={`g-${g.id}`} />
                  </YouthForm>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {g.status === "verified" ? (
                    <YouthForm op="guardian_update" hidden={{ id: g.id, status: "suspended", verification_method: g.verification_method ?? "" }} submit="Pause access" size="sm" variant="secondary" inline>
                      {Object.entries(g.permissions).map(([k, v]) => (v ? <input key={k} type="hidden" name={`perm_${k}`} value="on" /> : null))}
                    </YouthForm>
                  ) : null}
                  {g.status === "suspended" ? (
                    <YouthForm op="guardian_update" hidden={{ id: g.id, status: "verified", verification_method: g.verification_method ?? "" }} submit="Restore access" size="sm" variant="secondary" inline>
                      {Object.entries(g.permissions).map(([k, v]) => (v ? <input key={k} type="hidden" name={`perm_${k}`} value="on" /> : null))}
                    </YouthForm>
                  ) : null}
                  {["verified", "suspended", "pending"].includes(g.status) ? (
                    <YouthForm op="guardian_update" hidden={{ id: g.id, status: "revoked" }} submit="Revoke (final)" size="sm" variant="danger-outline" inline />
                  ) : null}
                </div>
              </Card>
            ))}
            {c.guardians.length === 0 ? <p className="text-meta text-text-secondary">No guardians linked. Guardians are added only by approving their request.</p> : null}
          </div>
        </section>

        <section aria-labelledby="restrict">
          <SectionHeading id="restrict">Restriction</SectionHeading>
          <Card>
            {c.restricted ? (
              <YouthForm op="child_restrict" hidden={{ id: c.id, on: "false" }} submit="Lift restriction" variant="secondary" />
            ) : (
              <YouthForm op="child_restrict" hidden={{ id: c.id, on: "true" }} submit="Restrict access" variant="danger-outline">
                <SelectField label="Reason" name="reason" defaultValue="disputed_relationship" hint="Nobody is notified. Guardians see only that access is paused.">
                  {Object.entries(RESTRICTION_REASONS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </SelectField>
              </YouthForm>
            )}
          </Card>
        </section>

        <section aria-labelledby="account">
          <SectionHeading id="account">Independent account</SectionHeading>
          <Card className="space-y-4">
            {!s.independent_accounts ? <p className="text-text-secondary">Not allowed under the current policy.</p> : null}
            {c.account ? (
              <p>
                Linked to {c.account.name} since {formatDay(c.account.linked_at)} · {c.account.active ? "active" : `not active (${c.account.status})`}
              </p>
            ) : null}
            {policy?.approved ? (
              <div className="space-y-2">
                <p>
                  Eligibility under policy version {c.policy_version}:{" "}
                  {c.eligibility ? (
                    <strong>
                      {c.eligibility.independent_account ? "eligible" : "not eligible"} ({formatDay(c.eligibility.determined_at)}, {c.eligibility.determined_by})
                    </strong>
                  ) : (
                    <strong>not assessed</strong>
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <YouthForm op="eligibility" hidden={{ child: c.id, independent: "true" }} submit="Record: eligible" size="sm" variant="secondary" inline />
                  <YouthForm op="eligibility" hidden={{ child: c.id, independent: "false" }} submit="Record: not eligible" size="sm" variant="secondary" inline />
                </div>
                {s.eligibility_rule ? <p className="text-meta text-text-secondary">Church rule: {String(s.eligibility_rule)}</p> : null}
              </div>
            ) : null}
            {s.independent_accounts && !c.account ? (
              openInvite ? (
                <div className="space-y-2">
                  <p>
                    Invitation for {openInvite.email}, expires {formatWhen(openInvite.expires_at)} ·{" "}
                    {openInvite.guardian_authorized ? "guardian authorized" : "waiting for a guardian's authorization"}
                  </p>
                  <YouthForm op="invite_revoke" hidden={{ invitation: openInvite.id }} submit="Revoke invitation" size="sm" variant="danger-outline" inline />
                </div>
              ) : (
                <YouthForm op="invite" hidden={{ child: c.id }} submit="Create invitation code">
                  <TextField label="The youth's own email address" name="email" type="email" autoComplete="off" required />
                  {s.guardian_authorization_required ? (
                    <p className="text-meta text-text-secondary">A verified guardian allowed to manage the account must authorize it from their family dashboard before it can be activated.</p>
                  ) : null}
                </YouthForm>
              )
            ) : null}
          </Card>
        </section>

        {c.account && s.adult_transition ? (
          <section aria-labelledby="transition">
            <SectionHeading id="transition">Adult transition</SectionHeading>
            <Card className="space-y-3">
              {c.transition ? (
                <>
                  <p>
                    Started {formatDay(c.transition.started_at)} ·{" "}
                    {c.transition.status === "confirmed" ? `confirmed by the youth ${formatDay(c.transition.youth_confirmed_at)}` : "waiting for the youth to confirm"}
                  </p>
                  {c.transition.status === "confirmed" ? (
                    <YouthForm op="transition_complete" hidden={{ id: c.transition.id }} submit="Complete transition" variant="danger-outline">
                      <p className="text-meta text-text-secondary">
                        Guardian access ends, youth groups and upcoming youth places end, learning history stays. Direct messaging is not granted: a
                        membership administrator decides that separately. Directory listing stays off until they choose it. A family administrator other
                        than the one who started it must complete it.
                      </p>
                      <TextField label='Type "complete transition" to confirm' name="confirm" autoComplete="off" required />
                    </YouthForm>
                  ) : null}
                  <YouthForm op="transition_cancel" hidden={{ id: c.transition.id }} submit="Cancel transition" size="sm" variant="secondary" inline />
                </>
              ) : (
                <YouthForm op="transition_start" hidden={{ child: c.id }} submit="Start transition">
                  <CheckboxField name="eligibility_confirmed" label="I reassessed eligibility for adult access under the current policy" />
                  <CheckboxField name="identity_confirmed" label="I confirmed the person's identity and that this account is theirs" />
                </YouthForm>
              )}
            </Card>
          </section>
        ) : null}

        <section aria-labelledby="archive">
          <SectionHeading id="archive">Archive</SectionHeading>
          <Card>
            {c.status === "active" ? (
              <YouthForm op="child_archive" hidden={{ id: c.id }} submit="Archive child profile" variant="danger-outline">
                <p className="text-meta text-text-secondary">Ends group enrollments and upcoming registrations. Records are kept (see the retention guide).</p>
                <TextField label='Type "archive" to confirm' name="confirm" autoComplete="off" required />
              </YouthForm>
            ) : (
              <p>{c.status === "transitioned" ? "This person moved to adult access." : "Archived."}</p>
            )}
          </Card>
        </section>

        <section aria-labelledby="history">
          <SectionHeading id="history" description="Actions and states only, never values.">
            History
          </SectionHeading>
          <ol className="space-y-1 text-meta">
            {c.history.map((h, i) => (
              <li key={i}>
                {formatWhen(h.at)} · {h.action}
                {h.from || h.to ? ` (${h.from ?? "—"} → ${h.to ?? "—"})` : ""}
                {h.fields.length ? ` · ${h.fields.join(", ")}` : ""}
                {h.by ? ` · ${h.by}` : ""}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
