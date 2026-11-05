import { ExternalLink, Library, Link2, Search } from "lucide-react";
import type { ReactNode } from "react";
import { FolderCard } from "@/components/media/reading/collections";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { catalogCount, type CatalogLinkRow, type CatalogShelf, type CatalogTopicRef } from "@/lib/prayer/catalog";

/**
 * A prayer link catalogue in the Prayer Library: titles, the source's own
 * topic labels, and a link out. No prayer text is held or shown here, so
 * every row says where it opens, and opens in a new tab so the reader keeps
 * their place in the library.
 */
export function CatalogLinkList({ items, label }: { items: CatalogLinkRow[]; label: string }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label={label}>
      {items.map((l) => (
        <li key={l.id}>
          <Card className="flex h-full min-w-0 flex-col gap-2 p-4">
            <h3 className="text-title font-semibold leading-snug text-text [overflow-wrap:anywhere]">{l.title}</h3>
            {l.topics.length ? (
              <p className="text-meta text-text-secondary [overflow-wrap:anywhere]">{l.topics.map((t) => t.name).join(" · ")}</p>
            ) : null}
            <p className="mt-auto pt-1">
              <a
                href={l.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline focus-visible:outline-3 focus-visible:outline-primary"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open prayer
                <span className="sr-only"> — {l.title} (opens on the source&apos;s site in a new tab)</span>
              </a>
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * Search and topic filter for one catalogue. A plain GET form: there is
 * nothing private here (titles and labels the source publishes), so the
 * reader can bookmark or share what they are looking at, and it works
 * without JavaScript.
 */
export function CatalogFilters({
  action,
  topics,
  topic,
  query,
  resetHref,
}: {
  action: string;
  topics: Array<CatalogTopicRef & { count: number }>;
  topic: string | null;
  query: string;
  resetHref: string;
}) {
  const filtered = !!topic || !!query;
  return (
    <form method="get" action={action} role="search" className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 basis-full sm:basis-64">
        <label htmlFor="catalog-q" className="mb-1 block text-meta font-semibold text-text-secondary">
          Search these prayers
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
          <input
            id="catalog-q"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={100}
            autoComplete="off"
            placeholder="Search by title or topic"
            className="block min-h-13 w-full rounded-full border border-border-strong bg-surface pl-12 pr-4 text-base text-text shadow-(--elev-card) placeholder:text-text-secondary focus-visible:outline-3 focus-visible:outline-primary"
          />
        </div>
      </div>
      {topics.length ? (
        <div className="min-w-0 flex-1 basis-full sm:basis-56">
          <label htmlFor="catalog-topic" className="mb-1 block text-meta font-semibold text-text-secondary">
            Topic
          </label>
          <Select
            id="catalog-topic"
            name="topic"
            defaultValue={topic ?? ""}
            className="block min-h-13 w-full rounded-full border border-border-strong bg-surface px-4 text-base text-text shadow-(--elev-card) focus-visible:outline-3 focus-visible:outline-primary"
          >
            <option value="">Every topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.count.toLocaleString("en-US")})
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" icon={<Search className="size-4" aria-hidden="true" />}>
          Search
        </Button>
        {filtered ? (
          <ButtonLink href={resetHref} variant="ghost">
            Clear
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}

/**
 * A catalogue as a folder beside the library's own collections, marked with
 * where its prayers live so nobody expects to read them here.
 */
export function CatalogFolder({ href, catalog }: { href: string; catalog: Pick<CatalogShelf, "name" | "description" | "source_name" | "count"> }) {
  return (
    <FolderCard
      href={href}
      name={catalog.name}
      description={catalog.description}
      countLabel={catalogCount(catalog.count)}
      note={`Links to ${catalog.source_name}`}
      art={<Link2 className="mb-4 size-12 text-primary/80" strokeWidth={1.4} />}
    />
  );
}

/** "Prayers from other sources" heading for the Collections view. */
export function CatalogSectionNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-meta text-text-secondary">
      <Library className="mr-1 inline size-4 align-text-bottom text-text-secondary" aria-hidden="true" />
      {children}
    </p>
  );
}

export { collectionGridClass } from "@/components/media/reading/collections";
