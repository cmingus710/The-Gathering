import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { YouthForm } from "@/components/youth/youth-form";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "Permission forms" };

type Form = {
  id: string;
  title: string;
  status: string;
  current_version: number | null;
  events: number;
  versions: Array<{ id: string; version: number; status: string; material: boolean; body: string; statement: string; change_summary: string; published_at: string | null }>;
};

export default async function FormsPage() {
  await requireCapability(CAPABILITIES.youthForms, "/admin/youth/forms");
  const { data, failed } = await youthRead<Form[]>("youth_admin_forms");
  return (
    <>
      <PageHeader
        title="Permission forms"
        description="Published versions never change. A change that affects what guardians agree to is material: earlier permission no longer counts and guardians of registered children are asked to review it. Use non-material only for wording fixes."
      />
      {failed || !data ? <Alert tone="error" title="Forms couldn't be loaded right now." /> : null}
      <div className="space-y-8">
        {(data ?? []).map((f) => {
          const draft = f.versions.find((v) => v.status === "draft");
          const current = f.versions.find((v) => v.status === "published");
          return (
            <section key={f.id} aria-labelledby={`f-${f.id}`}>
              <SectionHeading
                id={`f-${f.id}`}
                description={`${f.current_version ? `Version ${f.current_version} published` : "Not published yet"} · required by ${f.events} event${f.events === 1 ? "" : "s"}`}
                action={f.status === "archived" ? <Badge tone="neutral">Archived</Badge> : undefined}
              >
                {f.title}
              </SectionHeading>
              <Card className="space-y-5">
                <YouthForm op="form_save" hidden={{ id: f.id }} submit="Save" size="sm" className="space-y-3">
                  <TextField id={`title-${f.id}`} label="Title" name="title" defaultValue={f.title} maxLength={160} required />
                  <SelectField id={`status-${f.id}`} label="Status" name="status" defaultValue={f.status}>
                    <option value="active">Active</option>
                    <option value="archived">Archived (can&apos;t be newly required)</option>
                  </SelectField>
                </YouthForm>
                <div className="border-t border-border pt-4">
                  <h3 className="font-semibold">{draft ? `Draft version ${draft.version}` : "New version"}</h3>
                  <YouthForm op="form_draft" hidden={{ form: f.id }} submit="Save draft version" size="sm" className="mt-2 space-y-3">
                    <TextAreaField id={`body-${f.id}`} label="Form text" name="body" rows={8} maxLength={20000} required defaultValue={draft?.body ?? current?.body ?? ""} />
                    <TextField id={`statement-${f.id}`} label="Statement guardians agree to" name="statement" maxLength={1000} required defaultValue={draft?.statement ?? current?.statement ?? "I give permission for my child to take part."} />
                    <SelectField id={`material-${f.id}`} label="Kind of change" name="material" defaultValue={draft ? String(draft.material) : "true"} hint="The first version is always material.">
                      <option value="true">Material: guardians must decide again</option>
                      <option value="false">Wording fix only: earlier permission still counts</option>
                    </SelectField>
                    <TextField id={`summary-${f.id}`} label="What changed (shown to guardians)" name="change_summary" maxLength={500} defaultValue={draft?.change_summary ?? ""} />
                  </YouthForm>
                  {draft ? (
                    <YouthForm op="form_publish" hidden={{ version: draft.id }} submit={`Publish version ${draft.version}`} size="sm" className="mt-3 space-y-3">
                      <TextField id={`confirm-${f.id}`} label='Type "publish" to confirm' name="confirm" autoComplete="off" required />
                    </YouthForm>
                  ) : null}
                </div>
                <details>
                  <summary className="min-h-11 cursor-pointer font-semibold">Version history</summary>
                  <ul className="mt-2 space-y-2 text-meta">
                    {f.versions.map((v) => (
                      <li key={v.id}>
                        Version {v.version} · {v.status === "published" ? `published ${formatDay(v.published_at)}` : "draft"} · {v.material ? "material" : "wording fix"}
                        {v.change_summary ? ` · ${v.change_summary}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              </Card>
            </section>
          );
        })}
        <section aria-labelledby="new">
          <SectionHeading id="new">New form</SectionHeading>
          <Card>
            <YouthForm op="form_save" submit="Create form">
              <TextField label="Title" name="title" maxLength={160} required />
            </YouthForm>
          </Card>
        </section>
      </div>
    </>
  );
}
