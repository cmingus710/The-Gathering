import { BookOpen, ExternalLink, Link2, NotebookPen } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { bibleTarget, bodyBlocks } from "@/lib/devotionals/calendar";
import type { CollectionInfo, CollectionReading } from "@/lib/devotionals/types";
import { formatDay } from "@/lib/media/format";

export const collectionHref = (key: string) => `/devotionals/collections/${encodeURIComponent(key)}`;
export const readingHref = (key: string, id: string, on?: string) => `${collectionHref(key)}/readings/${id}${on ? `?on=${on}` : ""}`;
export const dayHref = (key: string, date: string, slot: string) => `${collectionHref(key)}?date=${date}&slot=${slot}`;

/**
 * One reading of an imported collection, exactly as the source has it:
 * the key verse as the author quoted it, then the text, paragraph by
 * paragraph, with hymn lines kept on their own lines. Rendered as text,
 * never as HTML. The Scripture reference opens the app's Bible reader in
 * the member's own translation; the quotation itself is never replaced.
 */
export function ReadingView({
  collection,
  reading,
  date,
  reflectionId,
  member,
}: {
  collection: CollectionInfo;
  reading: CollectionReading;
  /** The calendar date being read (what a reflection is dated). */
  date: string;
  reflectionId: string | null;
  member: boolean;
}) {
  const target = bibleTarget(reading.scripture_ref);
  const blocks = bodyBlocks(reading.body);
  return (
    <article aria-labelledby="reading-title" className="space-y-6">
      <header className="space-y-3">
        <p className="text-meta font-semibold text-text-secondary">
          {collection.title} · {reading.slot === "morning" ? "Morning reading" : "Evening reading"}
        </p>
        <h2 id="reading-title" className="sr-only">
          {reading.label}
        </h2>
        <blockquote className="font-display text-[1.375rem] font-semibold leading-snug text-text sm:text-[1.5rem]">
          <p className="[overflow-wrap:anywhere]">{reading.key_verse}</p>
        </blockquote>
        <div className="flex flex-wrap items-center gap-2">
          {reading.scripture_ref ? (
            target && member ? (
              <Link
                href={`/bible/read?b=${target.book}&c=${target.chapter}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary-soft px-3 text-meta font-semibold text-primary hover:underline"
              >
                <BookOpen className="size-4" aria-hidden="true" />
                {reading.scripture_ref}
                <span className="sr-only"> (open in the Bible reader)</span>
              </Link>
            ) : (
              <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary-soft px-3 text-meta font-semibold text-primary">
                <BookOpen className="size-4" aria-hidden="true" />
                {reading.scripture_ref}
              </span>
            )
          ) : null}
          {collection.author ? <span className="text-meta text-text-secondary">by {collection.author}</span> : null}
        </div>
      </header>

      <div className="prose-gathering font-display text-[1.0625rem] leading-[1.75] text-text sm:text-[1.125rem]">
        {blocks.map((b, i) =>
          b.kind === "paragraph" ? (
            <p key={i}>{b.text}</p>
          ) : (
            <p key={i} className="border-l-2 border-border pl-4">
              {b.lines.map((line, n) => (
                <span key={n} className="block">
                  {line}
                </span>
              ))}
            </p>
          ),
        )}
      </div>

      {member ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <ButtonLink
            href={reflectionId ? `/journal/${reflectionId}` : `/journal/new?reading=${reading.id}&on=${date}`}
            size="sm"
            icon={<NotebookPen className="size-4" aria-hidden="true" />}
          >
            {reflectionId ? "Open my reflection" : "Reflect in My Journal"}
          </ButtonLink>
          <ButtonLink href={readingHref(collection.key, reading.id)} variant="secondary" size="sm" icon={<Link2 className="size-4" aria-hidden="true" />}>
            Link to this reading
          </ButtonLink>
        </div>
      ) : null}
      {member ? (
        <p className="-mt-3 text-meta text-text-secondary">
          {reflectionId ? `You wrote a reflection on this reading for ${formatDay(date, "long")}. ` : `A reflection is private and dated ${formatDay(date, "long")}. `}
          Only you can see your journal.
        </p>
      ) : null}
    </article>
  );
}

/** Where the text comes from: author, rights, the text's source, and the data file's licence and commit. */
export function CollectionAttribution({ collection }: { collection: CollectionInfo }) {
  const s = collection.source;
  return (
    <section aria-labelledby="about-text" className="mt-10 rounded-card border border-border bg-surface px-4 py-4 text-meta sm:px-5">
      <h2 id="about-text" className="mb-2 text-title font-semibold text-text">
        About this text
      </h2>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <dt className="font-semibold text-text-secondary">Title and author</dt>
        <dd>
          {collection.title} — {collection.author}
        </dd>
        {collection.rights_statement ? (
          <>
            <dt className="font-semibold text-text-secondary">Rights</dt>
            <dd>{collection.rights_statement}</dd>
          </>
        ) : null}
        {collection.text_source_url ? (
          <>
            <dt className="font-semibold text-text-secondary">Text source</dt>
            <dd>
              <ExternalAnchor href={collection.text_source_url}>Christian Classics Ethereal Library (CCEL)</ExternalAnchor>
            </dd>
          </>
        ) : null}
        {s.repository ? (
          <>
            <dt className="font-semibold text-text-secondary">Imported from</dt>
            <dd className="[overflow-wrap:anywhere]">
              <ExternalAnchor href={s.commit ? `${s.repository}/tree/${s.commit}` : s.repository}>
                {s.repository.replace(/^https:\/\/github\.com\//, "")}
              </ExternalAnchor>
              {s.path ? ` · ${s.path}` : ""}
              {s.commit ? ` · commit ${s.commit.slice(0, 7)}` : ""}
              {s.imported_at ? ` · ${formatDay(s.imported_at.slice(0, 10), "long")}` : ""}
            </dd>
          </>
        ) : null}
        {s.license_notice ? (
          <>
            <dt className="font-semibold text-text-secondary">Licence</dt>
            <dd>{s.license_notice}</dd>
          </>
        ) : null}
      </dl>
      <p className="mt-3 text-text-secondary">Scripture quotations are part of the original devotional and are shown as the author wrote them.</p>
    </section>
  );
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
      {children}
      <ExternalLink className="size-3.5" aria-hidden="true" />
      <span className="sr-only"> (opens a new tab)</span>
    </a>
  );
}
