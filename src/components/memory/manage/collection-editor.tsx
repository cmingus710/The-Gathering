import { ArrowDown, ArrowUp, Eye } from "lucide-react";
import Link from "next/link";
import { PassageText } from "@/components/memory/passage";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionHeading } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { BOOK_LIST } from "@/lib/bible/books";
import { addItemAction, collectionStatusAction, coverAction, itemOpAction, saveItemAction, sequenceAction } from "@/lib/memory/manage-actions";
import { audienceLabel, collectionStatus, formatDay } from "@/lib/memory/format";
import { utcToZonedLocal } from "@/lib/time";
import { ActionForm } from "./action-form";
import { CollectionForm } from "./collection-form";
import type { AdminCollection, AdminHome, ManageBase } from "./types";

/**
 * One collection: details, cover, publishing (now or scheduled), archive,
 * duplicate, delete (unused drafts only), verses with their assignment
 * windows, editorial notes and hints, order, and text-version updates.
 * Scripture is chosen by reference from the approved source and never typed
 * or edited here.
 */
export function CollectionEditor({ c, home, base, coverUrl }: { c: AdminCollection; home: AdminHome; base: ManageBase; coverUrl?: string }) {
  const st = collectionStatus(c);
  const editable = c.status === "draft" || c.can_publish;
  const leader = base === "/memory/lead";
  const groups = leader ? home.led_groups : home.groups.map((g) => ({ id: g.id, name: g.name }));
  const hidden = { base, id: c.id };
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="text-meta text-text-secondary">
          {audienceLabel(c)} · {c.translation.name} ({c.translation.code}) · {c.item_count} verses
          {c.scheduled && c.publish_at ? ` · appears ${formatDay(c.publish_at.slice(0, 10))}` : ""}
        </span>
      </div>
      {!editable ? <Alert tone="info" title="This collection is published. A memory verse publisher can change it." /> : null}

      <section aria-labelledby="publishing">
        <SectionHeading id="publishing">Publishing</SectionHeading>
        <Card className="space-y-4">
          {c.can_publish ? (
            <div className="flex flex-wrap items-end gap-3">
              {c.status !== "archived" && (c.status === "draft" || c.scheduled) ? (
                <ActionForm action={collectionStatusAction} hidden={{ ...hidden, op: "publish" }}>
                  <SubmitButton size="sm" pendingText="Publishing…">
                    Publish now
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {c.status === "draft" ? (
                <ActionForm action={collectionStatusAction} hidden={{ ...hidden, op: "schedule", timezone: c.timezone }} className="flex flex-wrap items-end gap-2">
                  <TextField label={`Publish at (${c.timezone.replaceAll("_", " ")})`} name="publish_at" type="datetime-local" required className="min-w-56" />
                  <SubmitButton size="sm" variant="secondary" pendingText="Scheduling…">
                    Schedule
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {c.scheduled ? (
                <ActionForm action={collectionStatusAction} hidden={{ ...hidden, op: "unschedule" }}>
                  <SubmitButton size="sm" variant="ghost">
                    Back to draft
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {c.status === "published" ? (
                <ActionForm action={collectionStatusAction} hidden={{ ...hidden, op: "archive" }}>
                  <SubmitButton size="sm" variant="secondary">
                    Archive
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {c.status === "archived" ? (
                <ActionForm action={collectionStatusAction} hidden={{ ...hidden, op: "restore" }}>
                  <SubmitButton size="sm" variant="secondary">
                    Restore
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          ) : (
            <p className="text-meta text-text-secondary">A memory verse publisher publishes or schedules this collection.</p>
          )}
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <ActionForm action={collectionStatusAction} hidden={{ ...hidden, op: "duplicate" }} className="flex flex-wrap items-end gap-2">
              <TextField label="Duplicate as" name="title" defaultValue={`${c.title} (copy)`} maxLength={120} className="min-w-56" />
              <SubmitButton size="sm" variant="secondary" pendingText="Duplicating…">
                Duplicate
              </SubmitButton>
            </ActionForm>
            {c.status === "draft" && !c.published_at ? (
              <ActionForm action={collectionStatusAction} hidden={{ ...hidden, op: "delete" }}>
                <SubmitButton size="sm" variant="danger-outline" pendingText="Deleting…">
                  Delete draft
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
          <p className="text-meta text-text-secondary">Archiving hides a collection from browsing; members keep their verses and history. Duplicating starts a new draft from the source&apos;s current text.</p>
        </Card>
      </section>

      {editable ? (
        <section aria-labelledby="details">
          <SectionHeading id="details">Details</SectionHeading>
          <Card>
            <CollectionForm base={base} collection={c} translations={home.translations} defaultTranslation={home.default_translation_id} groups={groups} leaderOnly={leader} timezone={home.church_timezone} />
          </Card>
        </section>
      ) : null}

      {editable ? (
        <section aria-labelledby="cover">
          <SectionHeading id="cover">Cover image</SectionHeading>
          <Card>
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; never through the image cache
              <img src={coverUrl} alt={c.cover_alt ?? ""} className="mb-4 aspect-[16/7] w-full max-w-xl rounded-tile object-cover" />
            ) : null}
            <ActionForm action={coverAction} hidden={hidden} className="grid gap-3 sm:grid-cols-2">
              <TextField label="Image" name="cover" type="file" accept="image/png,image/jpeg,image/webp" />
              <TextField label="Description for screen readers" name="cover_alt" maxLength={300} defaultValue={c.cover_alt ?? ""} optional />
              <div className="flex gap-2 sm:col-span-2">
                <SubmitButton size="sm" variant="secondary" pendingText="Uploading…">
                  Save cover
                </SubmitButton>
                {c.cover_path ? (
                  <SubmitButton size="sm" variant="ghost" name="remove" value="1">
                    Remove cover
                  </SubmitButton>
                ) : null}
              </div>
            </ActionForm>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="verses">
        <SectionHeading
          id="verses"
          description="Verses keep a stable identity: reordering, renaming, or archiving never touches members' practice history."
          action={
            c.items.length ? (
              <ButtonLink href={`${base}/collections/${c.id}/preview`} size="sm" variant="secondary" icon={<Eye className="size-4" aria-hidden="true" />}>
                Preview activities
              </ButtonLink>
            ) : null
          }
        >
          Verses and assignments
        </SectionHeading>
        <ol className="space-y-4">
          {c.items.map((i) => (
            <li key={i.id} className={`rounded-card border border-border bg-surface p-4 ${i.retired ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">
                  {i.retired ? "Retired · " : `${i.position}. `}
                  {i.passage.label} ({i.passage.translation.code}) {i.passage.version > 1 ? <span className="text-text-secondary">· text version {i.passage.version}</span> : null}
                </h3>
                <span className="text-meta text-text-secondary">
                  {i.passage.word_count} words{i.starts_on && i.ends_on ? ` · assigned ${formatDay(i.starts_on)} – ${formatDay(i.ends_on)}` : ""}
                  {i.in_use ? " · members are practicing it" : ""}
                </span>
              </div>
              {i.suitability.length ? (
                <ul className="mt-2 list-disc pl-5 text-meta text-text-secondary">
                  {i.suitability.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : null}
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary">Show the text</summary>
                <PassageText passage={i.passage} className="mt-2" />
              </details>
              {!i.retired && editable ? (
                <>
                  <ActionForm action={saveItemAction} hidden={{ base, item_id: i.id }} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <TextField label="Title (editorial)" name="title" maxLength={120} defaultValue={i.title ?? ""} optional />
                    <TextField label="Hint (editorial)" name="hint" maxLength={300} defaultValue={i.hint ?? ""} optional hint="Shown only when a member asks for it." />
                    <TextAreaField label="Note or explanation" name="note" rows={2} maxLength={2000} defaultValue={i.note} optional className="sm:col-span-2" />
                    <TextField label="Assigned from" name="starts_on" type="date" defaultValue={i.starts_on ?? ""} optional />
                    <TextField label="Assigned until" name="ends_on" type="date" defaultValue={i.ends_on ?? ""} optional />
                    <div className="sm:col-span-2">
                      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                        Save verse details
                      </SubmitButton>
                    </div>
                  </ActionForm>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                    <ActionForm action={itemOpAction} hidden={{ base, item_id: i.id, op: "up" }}>
                      <SubmitButton size="sm" variant="ghost" icon={<ArrowUp className="size-4" aria-hidden="true" />}>
                        <span>
                          Move up<span className="sr-only"> {i.passage.label}</span>
                        </span>
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={itemOpAction} hidden={{ base, item_id: i.id, op: "down" }}>
                      <SubmitButton size="sm" variant="ghost" icon={<ArrowDown className="size-4" aria-hidden="true" />}>
                        <span>
                          Move down<span className="sr-only"> {i.passage.label}</span>
                        </span>
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={itemOpAction} hidden={{ base, item_id: i.id, op: "remove" }}>
                      <SubmitButton size="sm" variant="danger-outline">
                        {i.in_use || c.published_at ? "Retire" : "Remove"}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                  {!i.current ? (
                    <ActionForm action={itemOpAction} hidden={{ base, item_id: i.id, op: "update_text" }} className="mt-3 space-y-2 rounded-tile border border-primary/50 bg-primary-soft/40 p-3">
                      <p className="font-semibold">The Bible source&apos;s text for this reference has changed.</p>
                      <p className="text-meta">Updating points this verse at the new text. Members keep their practice of the earlier text and are asked whether to switch; nothing switches silently.</p>
                      <TextField label="Explanation for members" name="reason" required maxLength={500} />
                      <SubmitButton size="sm" pendingText="Updating…">
                        Use the updated text
                      </SubmitButton>
                    </ActionForm>
                  ) : null}
                </>
              ) : null}
              {i.versions.length ? (
                <p className="mt-2 text-meta text-text-secondary">
                  Text history: {i.versions.map((v) => `version ${v.from_version} → ${v.to_version} on ${formatDay(v.changed_at.slice(0, 10))} (${v.reason})`).join("; ")}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        {!c.items.length ? <p className="text-text-secondary">No verses yet.</p> : null}
      </section>

      {editable && c.status !== "archived" ? (
        <section aria-labelledby="add">
          <SectionHeading id="add" description={`Choose by reference from ${c.translation.code}. The exact approved text is captured; long passages are split into practice parts automatically.`}>
            Add a verse
          </SectionHeading>
          <Card>
            <ActionForm action={addItemAction} hidden={{ base, collection_id: c.id }} className="grid gap-3 sm:grid-cols-4">
              <SelectField label="Book" name="book" defaultValue="JHN" className="sm:col-span-2">
                {BOOK_LIST.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </SelectField>
              <TextField label="Chapter" name="chapter" inputMode="numeric" pattern="\d{1,3}" required />
              <TextField label="End chapter" name="end_chapter" inputMode="numeric" pattern="\d{1,3}" optional hint="Only if it crosses chapters" />
              <TextField label="From verse" name="start_verse" inputMode="numeric" pattern="\d{1,3}" required />
              <TextField label="To verse" name="end_verse" inputMode="numeric" pattern="\d{1,3}" optional />
              <TextField label="Assigned from" name="starts_on" type="date" optional />
              <TextField label="Assigned until" name="ends_on" type="date" optional />
              <TextField label="Title (editorial)" name="title" maxLength={120} optional className="sm:col-span-2" />
              <TextField label="Hint (editorial)" name="hint" maxLength={300} optional className="sm:col-span-2" />
              <TextAreaField label="Note or explanation" name="note" rows={2} maxLength={2000} optional className="sm:col-span-4" />
              <div className="sm:col-span-4">
                <SubmitButton pendingText="Adding…">Add verse</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </section>
      ) : null}

      {editable && c.kind === "sequence" && c.items.length ? (
        <section aria-labelledby="sequence">
          <SectionHeading id="sequence" description="Assigns verse 1 to the first period, verse 2 to the next, and so on. You can still adjust any verse's dates afterwards.">
            Multiweek schedule
          </SectionHeading>
          <Card>
            <ActionForm action={sequenceAction} hidden={{ base, collection_id: c.id }} className="flex flex-wrap items-end gap-3">
              <TextField label="First verse starts" name="start" type="date" required defaultValue={c.items.find((i) => !i.retired)?.starts_on ?? ""} />
              <SelectField label="Each verse lasts" name="days" defaultValue="7">
                <option value="7">1 week</option>
                <option value="14">2 weeks</option>
                <option value="1">1 day</option>
                <option value="30">30 days</option>
              </SelectField>
              <SubmitButton variant="secondary" pendingText="Filling in…">
                Fill in dates
              </SubmitButton>
            </ActionForm>
          </Card>
        </section>
      ) : null}

      {c.challenges.length ? (
        <section aria-labelledby="chs">
          <SectionHeading id="chs">Challenges using this collection</SectionHeading>
          <ul className="space-y-1">
            {c.challenges.map((ch) => (
              <li key={ch.id}>
                <Link href={`${base}/challenges/${ch.id}`} className="font-semibold text-primary hover:underline">
                  {ch.title}
                </Link>{" "}
                <span className="text-meta text-text-secondary">
                  {formatDay(ch.starts_on)} – {formatDay(ch.ends_on)} · {ch.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="log">
        <SectionHeading id="log" description="What changed and when (never anyone's practice).">
          Change log
        </SectionHeading>
        {c.history.length ? (
          <ul className="space-y-1 text-meta">
            {c.history.map((h, k) => (
              <li key={k}>
                <span className="text-text-secondary">{utcToZonedLocal(h.at, c.timezone).replace("T", " ")}</span> · {h.action.replace("memory.", "").replaceAll("_", " ")}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-secondary">Nothing yet.</p>
        )}
      </section>
    </div>
  );
}
