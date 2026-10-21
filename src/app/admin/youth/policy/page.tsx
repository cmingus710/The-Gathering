import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { YouthForm } from "@/components/youth/youth-form";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { POLICY_SETTINGS, formatDay } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Youth policy" };

type Policy = {
  id: string;
  version: number;
  status: "draft" | "approved" | "retired";
  title: string;
  body: string;
  settings: Record<string, unknown>;
  approved_at: string | null;
  approval_reference: string | null;
  updated_by: string | null;
  approved_by: string | null;
  updated_at: string;
};

function SettingsFields({ settings }: { settings: Record<string, unknown> }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-[1.125rem] font-semibold">Settings</legend>
      {POLICY_SETTINGS.map((s) =>
        s.kind === "boolean" ? (
          <CheckboxField key={s.key} name={s.key} label={s.label} hint={s.hint} defaultChecked={settings[s.key] === true} />
        ) : s.kind === "select" ? (
          <SelectField key={s.key} name={s.key} label={s.label} hint={s.hint} defaultValue={String(settings[s.key] ?? s.options![0][0])}>
            {s.options!.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </SelectField>
        ) : s.kind === "number" ? (
          <TextField key={s.key} name={s.key} label={s.label} hint={s.hint} type="number" inputMode="numeric" defaultValue={settings[s.key] == null ? "" : String(settings[s.key])} />
        ) : (
          <TextAreaField key={s.key} name={s.key} label={s.label} hint={s.hint} rows={3} maxLength={2000} defaultValue={String(settings[s.key] ?? "")} />
        ),
      )}
    </fieldset>
  );
}

function Summary({ settings }: { settings: Record<string, unknown> }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {POLICY_SETTINGS.map((s) => {
        const v = settings[s.key];
        const shown =
          s.kind === "boolean" ? (v ? "Yes" : "No") : s.kind === "select" ? (s.options!.find(([k]) => k === v)?.[1] ?? String(v)) : v == null || v === "" ? "Not set" : String(v);
        return (
          <div key={s.key}>
            <dt className="text-meta text-text-secondary">{s.label}</dt>
            <dd className="font-semibold">{shown}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export default async function PolicyPage() {
  await requireCapability(CAPABILITIES.youthPolicy, "/admin/youth/policy");
  const { data, failed } = await youthRead<{ defaults: Record<string, unknown>; policies: Policy[] }>("youth_admin_policies");
  if (failed || !data) return <Alert tone="error" title="Policies couldn't be loaded right now." />;
  const approved = data.policies.find((p) => p.status === "approved");
  const draft = data.policies.find((p) => p.status === "draft");
  return (
    <>
      <PageHeader
        title="Youth & family policy"
        description="Church decisions, versioned. Nothing is enabled by default: until a version that allows a feature is approved, that feature stays off. These settings don't make anything legally compliant on their own; record where the church approved each version."
      />
      <div className="space-y-10">
        <section aria-labelledby="current">
          <SectionHeading id="current">In effect now</SectionHeading>
          <Card className="space-y-4">
            {approved ? (
              <>
                <p>
                  <Badge tone="success">Version {approved.version}</Badge> {approved.title} · approved {formatDay(approved.approved_at)}
                  {approved.approved_by ? ` by ${approved.approved_by}` : ""} · {approved.approval_reference}
                </p>
                <Summary settings={approved.settings} />
              </>
            ) : (
              <>
                <p className="font-semibold">No approved policy. Safe defaults apply:</p>
                <Summary settings={data.defaults} />
              </>
            )}
          </Card>
        </section>

        <section aria-labelledby="draft">
          <SectionHeading id="draft">{draft ? `Draft version ${draft.version}` : "Start a new version"}</SectionHeading>
          <Card>
            <YouthForm op="policy_save" hidden={{ id: draft?.id }} submit="Save draft">
              <TextField label="Title" name="title" defaultValue={draft?.title ?? approved?.title ?? "Youth and family policy"} maxLength={160} required />
              <TextAreaField
                label="Policy text"
                name="body"
                rows={8}
                maxLength={20000}
                defaultValue={draft?.body ?? approved?.body ?? ""}
                hint="The church's own wording. Guardians and youth can read the approved version."
              />
              <SettingsFields settings={draft?.settings ?? approved?.settings ?? data.defaults} />
            </YouthForm>
          </Card>
          {draft ? (
            <Card className="mt-4 space-y-4">
              <h3 className="font-semibold">Approve version {draft.version}</h3>
              <p className="text-meta text-text-secondary">
                Someone other than the last editor ({draft.updated_by ?? "unknown"}) must approve. Approving retires the current version and revokes open
                youth account invitations made under it.
              </p>
              <YouthForm op="policy_approve" hidden={{ id: draft.id }} submit="Approve">
                <TextField label="Where the church approved it" name="reference" maxLength={300} required hint='For example, "Elder board minutes, 2 November 2026".' />
                <TextField label={`Type "approve version ${draft.version}" to confirm`} name="confirm" autoComplete="off" required />
              </YouthForm>
              <YouthForm op="policy_discard" hidden={{ id: draft.id }} submit="Discard draft" variant="danger-outline" size="sm" inline />
            </Card>
          ) : null}
        </section>

        <section aria-labelledby="history">
          <SectionHeading id="history">History</SectionHeading>
          <ul className="space-y-2">
            {data.policies.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-border bg-surface px-4 py-3">
                <span>
                  Version {p.version}: {p.title}
                </span>
                <Badge tone={p.status === "approved" ? "success" : p.status === "draft" ? "warning" : "neutral"}>
                  {p.status === "approved" ? "In effect" : p.status === "draft" ? "Draft" : "Retired"}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
