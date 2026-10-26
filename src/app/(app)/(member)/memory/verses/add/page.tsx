import type { Metadata } from "next";
import Link from "next/link";
import { FumsTracker } from "@/components/bible/fums";
import { Attribution, ScriptureText } from "@/components/bible/scripture";
import { UNAVAILABLE_NOTE, UnavailableVersionOptions, versionLabel } from "@/components/memory/unavailable-versions";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireLearner } from "@/lib/auth/viewer";
import { BOOK_LIST, chapterCount, isBookCode } from "@/lib/bible/books";
import type { Translation, Verse } from "@/lib/bible/types";
import { ineligibleNote } from "@/lib/memory/eligibility";
import type { Card as MemoryCard, Item } from "@/lib/memory/types";
import { fetchMemoryText } from "@/lib/memory/provider";
import { loadMemoryVersions } from "@/lib/memory/versions";
import { requireClient } from "@/lib/supabase/server";
import { AddPassageForm } from "./add-form";

export const metadata: Metadata = { title: "Add a memory verse" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const int = (v: string) => (/^\d{1,3}$/.test(v) ? Number(v) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Preview = { ok: boolean; problem?: string; label?: string; translation?: Translation; verses?: Verse[] ; copyright?: string | null; fumsId?: string | null };

/**
 * Choose a passage from the approved Bible source, see its exact text, then
 * add it. Nothing is saved until "Add to My Verses". Only versions whose
 * text is stored here can be memorized (practice is checked against the
 * exact wording on the server). The version starts at the member's default
 * memory translation and can be changed for this verse alone.
 *
 * With ?item=&collection= (an assigned verse whose collection lets members
 * choose), the reference is fixed and only the version is chosen; the shared
 * assignment itself never changes.
 *
 * From a Scripture highlight (?source=highlight, from the Bible reader or My
 * Journal) the passage and its translation arrive preselected. A requested
 * version that can't be memorized is explained, never swapped for another.
 * A passage already in My Verses is offered to open instead of being added
 * again. Adding never changes the highlight, and removing the highlight
 * later never removes the verse.
 */
export default async function AddVersePage({ searchParams }: PageProps<"/memory/verses/add">) {
  await requireLearner("/memory/verses/add");
  const sp = await searchParams;
  const supabase = await requireClient();
  const itemId = UUID.test(one(sp.item)) ? one(sp.item) : null;
  const collectionId = UUID.test(one(sp.collection)) ? one(sp.collection) : null;
  const [tData, col] = await Promise.all([
    loadMemoryVersions(supabase),
    itemId && collectionId ? supabase.rpc("memory_collection", { p_id: collectionId }) : Promise.resolve(null),
  ]);
  const versions = tData;
  const stored = versions.items;
  const item = itemId ? ((col?.data as { items: Item[]; translation_choice: boolean } | null)?.items ?? []).find((i) => i.id === itemId) ?? null : null;
  const assignedIn = item ? item.passage.translation : null;
  const choiceAllowed = Boolean(item?.translation_choice);

  const requested = one(sp.t);
  const fromHighlight = one(sp.source) === "highlight";
  // A specific version was asked for (a highlight's translation) but can't
  // be memorized: say why, and don't preview another version in its place.
  const blocked = !item && requested && !stored.some((x) => x.id === requested)
    ? (versions.unavailable.find((x) => x.id === requested) ?? { id: requested, code: "That version", memory_reason: "not_published" as const })
    : null;
  const t = (stored.some((x) => x.id === requested) ? requested : "") || versions.effective_id || stored[0]?.id || "";
  const book = item ? item.passage.book : one(sp.book);
  const chapter = item ? item.passage.start_chapter : int(one(sp.c));
  const from = item ? item.passage.start_verse : int(one(sp.from));
  const endChapter = item ? item.passage.end_chapter : chapter;
  const to = item ? item.passage.end_verse : (int(one(sp.to)) ?? from);
  // An assignment that requires its version is added in that version only.
  const version = item && !choiceAllowed && assignedIn ? assignedIn.id : t;
  const asked = item ? Boolean(requested) || !choiceAllowed : true;
  let preview: Preview | null = null;
  if (asked && !blocked && version && isBookCode(book) && chapter && from && to && endChapter) {
    const { data, error } = await supabase.rpc("memory_passage_preview", { p_translation: version, p: { book, sc: chapter, sv: from, ec: endChapter, ev: to } });
    preview = error ? { ok: false, problem: error.code === "22023" ? error.message : "That passage couldn't be checked right now." } : (data as Preview);
    // A licensed version: its text is fetched here and shown unchanged; the
    // database never receives it.
    if (preview.ok && preview.translation?.source_kind === "api") {
      const text = await fetchMemoryText(supabase, version, { book, sc: chapter, sv: from, ec: endChapter, ev: to });
      preview =
        text.status === "ok"
          ? { ...preview, verses: text.verses, copyright: text.copyright, fumsId: text.fumsId }
          : { ok: false, problem: text.status === "stored" ? "That passage couldn't be checked right now." : text.message };
    }
  }
  // The same passage, in the same version, already in My Verses.
  let existing: { active: MemoryCard | null; removed: MemoryCard | null; overlapping: MemoryCard[] } = { active: null, removed: null, overlapping: [] };
  if (!item && preview?.ok && isBookCode(book) && chapter && from && to) {
    const { data } = await supabase.rpc("memory_cards");
    const cards = (data as { active: MemoryCard[]; removed: MemoryCard[] } | null) ?? { active: [], removed: [] };
    const same = (k: MemoryCard) =>
      k.passage.translation.id === version && k.passage.book === book && k.passage.start_chapter === chapter && k.passage.start_verse === from && k.passage.end_chapter === endChapter && k.passage.end_verse === to;
    const overlaps = (k: MemoryCard) =>
      k.passage.book === book &&
      k.passage.translation.id === version &&
      k.passage.start_chapter * 1000 + k.passage.start_verse <= endChapter! * 1000 + to &&
      k.passage.end_chapter * 1000 + k.passage.end_verse >= chapter * 1000 + from;
    existing = {
      active: cards.active.find(same) ?? null,
      removed: cards.removed.find((k) => k.status === "removed" && same(k)) ?? null,
      overlapping: cards.active.filter((k) => !same(k) && overlaps(k)),
    };
  }
  return (
    <>
      <BackLink route="/memory/verses/add" />
      <PageHeader
        title={item ? `Add ${item.passage.label}` : "Add a memory verse"}
        description={
          item
            ? "Choose the Bible version you'll memorize it in. You'll see its exact text before adding it."
            : "Choose a passage from the church's Bible versions. You'll see its exact text before adding it."
        }
      />
      {itemId && !item ? (
        <Alert tone="error" title="That assigned verse isn't available." />
      ) : !stored.length ? (
        <Alert tone="info" title="No Bible version is available for memory practice yet.">
          Memory practice needs a version whose text is stored by the church. Ask an administrator to set one up.
        </Alert>
      ) : (
        <div className="space-y-6">
          {item && assignedIn ? (
            <Alert tone="info" live={false} title={choiceAllowed ? `Assigned in ${assignedIn.name} (${assignedIn.code}). You may practice it in another version.` : `Assigned in ${assignedIn.name} (${assignedIn.code}).`}>
              {choiceAllowed
                ? "Your choice applies only to you; the assignment stays the same for everyone else."
                : "This assignment is practiced in that version."}
            </Alert>
          ) : null}
          {!item || choiceAllowed ? (
            <Card>
              <form method="get" className="grid gap-4 sm:grid-cols-2">
                {item ? (
                  <>
                    <input type="hidden" name="item" value={item.id} />
                    <input type="hidden" name="collection" value={collectionId ?? ""} />
                  </>
                ) : null}
                <SelectField
                  label="Bible version"
                  name="t"
                  defaultValue={t}
                  hint={`${t === versions.effective_id ? "Your default memory verse translation. Change it here for this verse only." : "For this verse only. Your default stays the same."}${versions.unavailable.length ? ` ${UNAVAILABLE_NOTE}` : ""}`}
                >
                  {stored.map((x) => (
                    <option key={x.id} value={x.id}>
                      {versionLabel(x)}
                    </option>
                  ))}
                  <UnavailableVersionOptions items={versions.unavailable} />
                </SelectField>
                {!item ? (
                  <>
                    <SelectField label="Book" name="book" defaultValue={isBookCode(book) ? book : "JHN"}>
                      {BOOK_LIST.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.name}
                        </option>
                      ))}
                    </SelectField>
                    <TextField label="Chapter" name="c" inputMode="numeric" pattern="\d{1,3}" defaultValue={chapter ? String(chapter) : ""} required hint={isBookCode(book) ? `1 to ${chapterCount(book)}` : undefined} />
                    <div className="grid grid-cols-2 gap-3">
                      <TextField label="From verse" name="from" inputMode="numeric" pattern="\d{1,3}" defaultValue={from ? String(from) : ""} required />
                      <TextField label="To verse" name="to" inputMode="numeric" pattern="\d{1,3}" defaultValue={to ? String(to) : ""} hint="Up to 30 verses" optional />
                    </div>
                  </>
                ) : null}
                <div className="sm:col-span-2">
                  <SubmitButton variant="secondary">Show the passage</SubmitButton>
                </div>
              </form>
            </Card>
          ) : null}
          {fromHighlight && !item ? (
            <Alert tone="info" live={false} title="From your highlight">
              The passage and its translation are filled in. Review the text, then add it. Your highlight stays as it is, and removing it later won&apos;t remove
              the memory verse.
            </Alert>
          ) : null}
          {blocked ? (
            <Alert tone="warning" title={ineligibleNote(blocked.code, blocked.memory_reason)}>
              Nothing was added, and no other version was chosen instead. You can pick a version that&apos;s available for memory practice above.
            </Alert>
          ) : null}
          {existing.active ? (
            <Alert tone="info" title={`${existing.active.passage.label} (${existing.active.passage.translation.code}) is already in My Verses.`}>
              <p>Open it to keep practicing; your progress is kept. It isn&apos;t added a second time.</p>
              <ButtonLink href={`/memory/verses/${existing.active.id}`} size="sm" variant="secondary" className="mt-2">
                Open in My Verses
              </ButtonLink>
            </Alert>
          ) : existing.removed ? (
            <Alert tone="info" live={false} title="You removed this verse earlier.">
              Adding it again brings it back with its earlier progress.
            </Alert>
          ) : null}
          {existing.overlapping.length ? (
            <Alert tone="info" live={false} title="Overlapping verses in My Verses">
              <ul className="list-disc pl-5">
                {existing.overlapping.map((k) => (
                  <li key={k.id}>
                    <Link href={`/memory/verses/${k.id}`} className="underline">
                      {k.passage.label} ({k.passage.translation.code})
                    </Link>
                  </li>
                ))}
              </ul>
              You can still add this passage as its own verse.
            </Alert>
          ) : null}
          {preview && !preview.ok ? (
            <Alert tone="error" title={preview.problem ?? "That passage can't be used."}>
              Nothing was added, and no other version was used instead. Choose another version or passage.
            </Alert>
          ) : null}
          {preview?.ok && preview.verses && preview.translation ? (
            <Card>
              <h2 className="mb-3 font-display text-[1.375rem] font-semibold">
                {preview.label} <span className="text-text-secondary">({preview.translation.code})</span>
              </h2>
              <ScriptureText verses={preview.verses} translation={preview.translation} label={`${preview.label} (${preview.translation.code})`} />
              <Attribution translation={preview.translation} extra={preview.copyright} />
              {preview.fumsId ? <FumsTracker ids={[preview.fumsId]} /> : null}
              <p className="mt-3 text-meta text-text-secondary">
                {preview.translation.source_kind === "api"
                  ? `${preview.translation.code} is licensed: it's shown exactly as published and isn't stored here. You'll practice it with flashcards and self-check.`
                  : `You'll practice and be checked against exactly this wording in ${preview.translation.code}.`}
              </p>
              <div className="mt-4">
                {existing.active ? null : item ? (
                  <AddPassageForm itemId={item.id} translation={version} book={book} chapter={chapter!} from={from!} endChapter={endChapter!} to={to!} />
                ) : (
                  <AddPassageForm translation={version} book={book} chapter={chapter!} from={from!} to={to!} />
                )}
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
