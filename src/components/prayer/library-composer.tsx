"use client";

import { BookOpen, CircleAlert, Eye, FilePen, FolderOpen, Info, Send } from "lucide-react";
import { useActionState, useMemo, useRef, useState } from "react";
import { saveLibraryPrayerAction } from "@/app/(app)/(member)/prayer/library/actions";
import { CommunityText } from "@/components/community/community-text";
import { LinkTextAreaField } from "@/components/links/link-tools";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { parseReferenceList } from "@/lib/media/scripture";
import {
  KIND_PLURAL,
  KINDS,
  LIBRARY_LIMITS,
  ORIGIN_LABEL,
  SHARING_REMINDER,
  type Category,
  type CategoryKind,
  type CollectionOption,
  type CollectionRef,
  type LibraryStatus,
  type Origin,
} from "@/lib/prayer/library";
import { CollectionPicker } from "./collection-picker";
import { CategoryLabels } from "./library-card";

const FORMAT_HINT = "You can use **bold**, _italic_, and lists. Add a link with the Link button, or paste an address over selected words.";

const KIND_HINT: Record<CategoryKind, string> = {
  topic: "What the prayer is about. Choose any that fit.",
  purpose: "What kind of prayer it is.",
  use: "Where it would work well.",
};

const KIND_LIMIT: Record<CategoryKind, number> = { topic: LIBRARY_LIMITS.topics, purpose: LIBRARY_LIMITS.purposes, use: LIBRARY_LIMITS.uses };

export type LibraryComposerInitial = {
  id: string;
  status: LibraryStatus;
  title: string;
  body: string;
  origin: Origin;
  sourceName: string;
  sourceUrl: string;
  scripture: string[];
  categories: string[];
  /** Its collection (null for an unassigned draft). */
  collection: CollectionRef | null;
};

/**
 * New or edited library prayer. Fields are controlled (state only, never
 * browser storage), so text survives a failed save. The preview shows
 * exactly what readers will see, attribution included. "Save draft" keeps it
 * private; "Publish" shares it with church members at once (no approval
 * step). The server checks everything again.
 */
export function LibraryComposer({
  categories,
  collections,
  initial,
  defaultCollection,
  contributor,
  postingRestricted,
}: {
  categories: Category[];
  /** Active collections to choose from. */
  collections: CollectionOption[];
  initial?: LibraryComposerInitial;
  /** Preselected for a new prayer (added from a collection page). */
  defaultCollection?: string | null;
  contributor: string;
  postingRestricted: boolean;
}) {
  const [state, formAction] = useActionState(saveLibraryPrayerAction, initialFormState);
  const v = state.values;
  const [title, setTitle] = useState(v?.title ?? initial?.title ?? "");
  const [body, setBody] = useState(v?.body ?? initial?.body ?? "");
  const [origin, setOrigin] = useState<Origin>((v?.origin as Origin) || initial?.origin || "original");
  const [sourceName, setSourceName] = useState(v?.sourceName ?? initial?.sourceName ?? "");
  const [sourceUrl, setSourceUrl] = useState(v?.sourceUrl ?? initial?.sourceUrl ?? "");
  const [scripture, setScripture] = useState(v?.scripture ?? initial?.scripture.join("\n") ?? "");
  const [chosen, setChosen] = useState<string[]>(() => (v?.categories ? v.categories.split(",").filter(Boolean) : (initial?.categories ?? [])));
  const [collection, setCollection] = useState<string | null>(() => {
    const id = v ? v.collection || null : (initial ? initial.collection?.id : defaultCollection) ?? null;
    return id && collections.some((c) => c.id === id) ? id : null;
  });
  const [clientKey] = useState(() => crypto.randomUUID());
  const previewRef = useRef<HTMLElement>(null);
  const fe = state.fieldErrors ?? {};
  const published = initial?.status === "published";

  // Archived categories still on an existing prayer stay chosen and visible.
  const known = useMemo(() => {
    const extra = (initial?.categories ?? []).filter((id) => !categories.some((c) => c.id === id));
    return { categories, extra };
  }, [categories, initial]);
  const refs = useMemo(() => parseReferenceList(scripture), [scripture]);
  const chosenCats = categories.filter((c) => chosen.includes(c.id));
  const chosenCollection = collections.find((c) => c.id === collection) ?? null;

  const toggle = (id: string, on: boolean) => setChosen((list) => (on ? [...list, id] : list.filter((x) => x !== id)));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form action={formAction} className="space-y-6">
        <FormMessage state={state} />
        {initial ? <input type="hidden" name="prayerId" value={initial.id} /> : null}
        <input type="hidden" name="wasPublished" value={String(published)} />
        <input type="hidden" name="clientKey" value={clientKey} />
        {known.extra.map((id) => (
          <input key={id} type="hidden" name="category" value={id} />
        ))}

        <div className="flex items-start gap-3 rounded-tile border border-primary/40 bg-primary-soft px-4 py-3 text-meta text-text">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            <strong>Before you share:</strong> {SHARING_REMINDER}
          </p>
        </div>

        <TextField label="Title" name="title" required minLength={3} maxLength={LIBRARY_LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} error={fe.title} hint="A few words, such as “A blessing before a meal”." />

        <LinkTextAreaField
          label="Prayer"
          name="body"
          required
          rows={10}
          maxLength={LIBRARY_LIMITS.body}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          error={fe.body}
          hint={FORMAT_HINT}
          toolbarLabel="Prayer formatting"
        />

        <CollectionPicker collections={collections} value={collection} onChange={setCollection} error={fe.collection} />

        {KINDS.map((kind) => {
          const options = categories.filter((c) => c.kind === kind);
          const count = chosen.filter((id) => options.some((o) => o.id === id)).length;
          const full = count >= KIND_LIMIT[kind];
          if (!options.length) return null;
          return (
            <fieldset key={kind} className="space-y-2" aria-describedby={`kind-${kind}-hint`}>
              <legend className="font-semibold">
                {KIND_PLURAL[kind]} <span className="font-normal text-text-secondary">(optional)</span>
              </legend>
              <p id={`kind-${kind}-hint`} className="text-meta text-text-secondary">
                {KIND_HINT[kind]} Up to {KIND_LIMIT[kind]}.
              </p>
              <ul className="flex flex-wrap gap-2">
                {options.map((c) => {
                  const on = chosen.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label
                        className={cn(
                          "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-meta font-semibold transition-colors",
                          "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                          on ? "border-primary bg-primary-soft text-text" : "border-border-strong bg-surface text-text hover:border-primary",
                          !on && full && "cursor-not-allowed opacity-55",
                        )}
                      >
                        <input
                          type="checkbox"
                          name="category"
                          value={c.id}
                          checked={on}
                          disabled={!on && full}
                          onChange={(e) => toggle(c.id, e.target.checked)}
                          className="size-4 accent-primary"
                        />
                        {c.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}

        <TextAreaField
          label="Scripture references"
          name="scripture"
          rows={3}
          optional
          value={scripture}
          onChange={(e) => setScripture(e.target.value)}
          error={fe.scripture}
          hint="One per line, for example “Psalm 23” or “Philippians 4:6–7”. Only the reference is stored; no Bible text is added."
        />
        {refs.refs.length || refs.invalid.length ? (
          <div className="-mt-4 space-y-1 text-meta" aria-live="polite">
            {refs.refs.length ? (
              <p className="flex flex-wrap items-center gap-1.5 text-text-secondary">
                Recognized:
                {refs.refs.map((r) => (
                  <span key={r} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 font-semibold text-primary">
                    <BookOpen className="size-3.5" aria-hidden="true" /> {r}
                  </span>
                ))}
              </p>
            ) : null}
            {refs.invalid.length ? (
              <p className="flex items-start gap-1.5 font-medium text-danger">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Not recognized yet: {refs.invalid.slice(0, 3).join("; ")}
              </p>
            ) : null}
          </div>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="mb-1 font-semibold">Who wrote it?</legend>
          {(["original", "shared"] as Origin[]).map((o) => (
            <label key={o} className={cn("flex cursor-pointer items-start gap-3 rounded-tile border px-4 py-3", origin === o ? "border-primary bg-primary-soft" : "border-border bg-surface")}>
              <input type="radio" name="origin" value={o} checked={origin === o} onChange={() => setOrigin(o)} className="mt-1 size-5 shrink-0 accent-primary" />
              <span className="min-w-0">
                <span className="block font-semibold">{ORIGIN_LABEL[o]}</span>
                <span className="block text-meta text-text-secondary">
                  {o === "original" ? "You wrote it. You'll be shown as its author." : "Written by someone else. Name them or the source; you'll be shown as the member who shared it."}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <TextField
          label={origin === "shared" ? "Original author or source" : "Credit or source"}
          name="sourceName"
          optional={origin === "original"}
          maxLength={LIBRARY_LIMITS.source}
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          error={fe.sourceName}
          hint={origin === "shared" ? "For example “Book of Common Prayer (1979)” or “Traditional”. Leave it blank only if the source is unknown." : "Only if you'd like to add one, for example “Written with my small group”."}
        />
        <TextField
          label="Source link"
          name="sourceUrl"
          type="url"
          inputMode="url"
          optional
          maxLength={LIBRARY_LIMITS.url}
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          error={fe.sourceUrl}
          hint="A web page where the original can be found."
        />

        {postingRestricted ? (
          <p className="rounded-tile border border-border bg-surface-muted px-4 py-3 text-meta">Your community posting is paused by a moderator. You can save a draft, but not publish right now.</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {postingRestricted && !published ? null : (
            <SubmitButton name="intent" value="publish" pendingText={published ? "Saving…" : "Publishing…"} icon={<Send className="size-4" aria-hidden="true" />} disabled={postingRestricted}>
              {published ? "Save changes" : "Publish"}
            </SubmitButton>
          )}
          {published ? null : (
            <SubmitButton name="intent" value="draft" variant="secondary" pendingText="Saving…" icon={<FilePen className="size-4" aria-hidden="true" />}>
              Save draft
            </SubmitButton>
          )}
          <Button
            variant="ghost"
            className="lg:hidden"
            icon={<Eye className="size-4" aria-hidden="true" />}
            onClick={() => {
              previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              previewRef.current?.focus({ preventScroll: true });
            }}
          >
            Preview
          </Button>
        </div>
        <p className="text-meta text-text-secondary">
          {published
            ? "Changes appear in the library as soon as you save."
            : "Publishing shares it with approved church members right away. Drafts are visible only to you."}
        </p>
      </form>

      <aside ref={previewRef} tabIndex={-1} aria-label="Preview" className="space-y-2 outline-none lg:sticky lg:top-6 lg:self-start">
        <p className="text-meta font-semibold uppercase tracking-wide text-text-secondary">Preview: how members will see it</p>
        <div className="space-y-3 rounded-card border border-border bg-surface p-5 shadow-(--elev-card)">
          {chosenCollection ? (
            <p className="flex items-center gap-1.5 text-meta font-semibold text-text-secondary">
              <FolderOpen className="size-4 shrink-0 text-primary" aria-hidden="true" />
              {chosenCollection.name}
            </p>
          ) : null}
          <h2 className="font-display text-xl font-semibold leading-snug">{title.trim() || "Your title"}</h2>
          <CategoryLabels categories={chosenCats} kinds={["topic", "purpose", "use"]} />
          {body.trim() ? <CommunityText source={body} /> : <p className="text-text-secondary">Your prayer will appear here.</p>}
          <div className="border-t border-border pt-3 text-meta text-text-secondary">
            {origin === "shared" ? (
              <>
                <p>
                  <span className="font-semibold text-text">By {sourceName.trim() || "another author or source"}</span>
                </p>
                <p>Shared by {contributor}</p>
              </>
            ) : (
              <p>
                <span className="font-semibold text-text">By {contributor}</span>
                {sourceName.trim() ? ` · ${sourceName.trim()}` : ""}
              </p>
            )}
            {refs.refs.length ? <p className="mt-1">Scripture: {refs.refs.join("; ")}</p> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
