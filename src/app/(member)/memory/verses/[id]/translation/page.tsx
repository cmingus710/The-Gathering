import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Attribution, ScriptureText } from "@/components/bible/scripture";
import { PassageText } from "@/components/memory/passage";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { SelectField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireLearner } from "@/lib/auth/viewer";
import type { Translation, Verse } from "@/lib/bible/types";
import { STAGES } from "@/lib/memory/format";
import type { CardDetail, MemoryTranslations, Stage } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";
import { ChangeTranslationForm } from "./form";

export const metadata: Metadata = { title: "Change translation" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type Effects = {
  sessions: number;
  stage: Stage;
  review_ready: boolean;
  restores: { id: string; stage: Stage; sessions: number; review_ready: boolean } | null;
  leaves_collection: { id: string; title: string } | null;
};
type Preview =
  | { ok: false; problem: string }
  | {
      ok: true;
      label: string;
      translation: Translation;
      verses: Verse[];
      only_current: string[];
      only_new: string[];
      effects: Effects;
    };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Change one verse's translation: choose a version, see the replacement text
 * exactly, read what happens to practice, then confirm. Nothing changes
 * before the confirmation, and other verses are never affected.
 */
export default async function ChangeTranslationPage({ params, searchParams }: PageProps<"/memory/verses/[id]/translation">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireLearner(`/memory/verses/${id}/translation`);
  const supabase = await requireClient();
  const [{ data, error }, tr] = await Promise.all([supabase.rpc("memory_card", { p_id: id }), supabase.rpc("memory_translations")]);
  if (error?.code === "P0002" || (error && /invalid input syntax/.test(error.message))) notFound();
  const c = data as CardDetail | null;
  if (!c) return <Alert tone="error" title="This verse couldn't be loaded right now." />;
  const current = c.passage.translation;
  const options = ((tr.data as MemoryTranslations | null)?.items ?? []).filter((t) => t.id !== current.id);
  const t = options.some((x) => x.id === one(sp.t)) ? one(sp.t) : "";
  let preview: Preview | null = null;
  if (t && c.can_change_translation) {
    const res = await supabase.rpc("memory_card_translation_preview", { p_card: c.id, p_translation: t });
    preview = res.error ? { ok: false, problem: res.error.code === "22023" ? res.error.message : "That version couldn't be checked right now." } : (res.data as Preview);
  }

  return (
    <>
      <BackLink route="/memory/verses/[id]/translation" params={{ id: c.id }} label={`${c.passage.label} (${current.code})`} />
      <PageHeader
        title="Change translation"
        description={`${c.passage.label} is in ${current.name} (${current.code}). Choosing another version affects only this verse; your default and your other verses stay the same.`}
      />
      {!c.can_change_translation ? (
        <Alert tone="info" title={c.assignment && !c.assignment.choice ? `This verse is assigned in ${c.assignment.translation.name} (${c.assignment.translation.code}).` : "This verse's translation can't be changed."}>
          {c.assignment && !c.assignment.choice
            ? "The assignment is practiced in that version. To learn it in another version as well, add it as your own verse."
            : "Only verses you're practicing can change translation."}
        </Alert>
      ) : !options.length ? (
        <Alert tone="info" title="No other Bible version is available for memory practice." />
      ) : (
        <div className="space-y-6">
          {c.assignment?.choice ? (
            <Alert tone="info" live={false} title={`Assigned in ${c.assignment.translation.code}; you may practice it in another version.`}>
              Your choice applies only to you. The assignment stays the same for everyone else.
            </Alert>
          ) : null}
          <Card>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <SelectField label="New Bible version" name="t" defaultValue={t} className="min-w-0 flex-1 basis-60">
                <option value="" disabled>
                  Choose a version
                </option>
                {options.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.code})
                  </option>
                ))}
              </SelectField>
              <SubmitButton variant="secondary">Preview</SubmitButton>
            </form>
          </Card>

          {preview && !preview.ok ? (
            <Alert tone="error" title={preview.problem}>
              Nothing was changed, and no other version was used instead. Choose another version.
            </Alert>
          ) : null}

          {preview?.ok ? (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <section aria-labelledby="now" className="rounded-card border border-border bg-surface p-4">
                  <SectionHeading id="now" as="h2">
                    Now: {current.code}
                  </SectionHeading>
                  <PassageText passage={c.passage} />
                </section>
                <section aria-labelledby="new" className="rounded-card border border-primary bg-surface p-4">
                  <SectionHeading id="new" as="h2">
                    New: {preview.translation.code}
                  </SectionHeading>
                  <ScriptureText verses={preview.verses} translation={preview.translation} label={`${preview.label} (${preview.translation.code})`} />
                  <Attribution translation={preview.translation} />
                </section>
              </div>
              {preview.only_current.length || preview.only_new.length ? (
                <Alert tone="warning" live={false} title="The two versions don't include the same verses here.">
                  {preview.only_new.length ? <p>Only in {preview.translation.code}: verse {preview.only_new.join(", ")}.</p> : null}
                  {preview.only_current.length ? <p>Only in {current.code}: verse {preview.only_current.join(", ")}.</p> : null}
                  <p>You&apos;d practice exactly the text shown above for {preview.translation.code}.</p>
                </Alert>
              ) : null}
              <section aria-labelledby="effects" className="rounded-card border border-border bg-surface p-4">
                <SectionHeading id="effects" as="h2">
                  What changes
                </SectionHeading>
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    You&apos;ll practice and be checked against the {preview.translation.code} wording from now on. Practice of one wording isn&apos;t practice of another, so{" "}
                    {preview.effects.restores
                      ? `your earlier ${preview.translation.code} progress for this verse comes back: ${STAGES[preview.effects.restores.stage].label.toLowerCase()}, ${plural(preview.effects.restores.sessions, "practice activity", "practice activities")}${preview.effects.restores.review_ready ? ", review-ready" : ""}.`
                      : `it starts fresh as a new verse, due for review today.`}
                  </li>
                  <li>
                    Your {current.code} practice ({STAGES[preview.effects.stage].label.toLowerCase()}, {plural(preview.effects.sessions, "practice activity", "practice activities")}
                    {preview.effects.review_ready ? ", review-ready" : ""}) is kept with the {current.code} text under &ldquo;Removed and earlier texts&rdquo;. You can switch back to it later.
                  </li>
                  <li>Badges you&apos;ve earned stay. Changing translation doesn&apos;t add practice to any group challenge.</li>
                  {preview.effects.leaves_collection ? (
                    <li>
                      It leaves your collection &ldquo;{preview.effects.leaves_collection.title}&rdquo;, which keeps one version.
                    </li>
                  ) : null}
                </ul>
                <div className="mt-4">
                  <ChangeTranslationForm id={c.id} translation={preview.translation.id} code={preview.translation.code} />
                </div>
              </section>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
