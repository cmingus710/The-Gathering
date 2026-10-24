import type { Metadata } from "next";
import Link from "next/link";
import { FeaturedItem } from "@/components/media/featured-item";
import { ItemCard } from "@/components/media/item-card";
import { VisitorNote } from "@/components/media/visitor-note";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { coverPaths, isUuid, isYmd } from "@/lib/media/format";
import { listItems } from "@/lib/media/pages";
import { BOOKS, bookOf } from "@/lib/media/scripture";
import { signPaths } from "@/lib/media/storage";
import { teachingViewer } from "@/lib/media/viewer";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sunday lessons" };

type Facets = { series: Array<{ id: string; title: string }>; people: Array<{ id: string; name: string }>; topics: Array<{ id: string; name: string }>; refs: string[] };

const PAGE = 20;

export default async function LessonsPage({ searchParams }: PageProps<"/lessons">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filters = {
    q: str("q").slice(0, 80),
    series_id: isUuid(str("series")) ? str("series") : "",
    person_id: isUuid(str("speaker")) ? str("speaker") : "",
    topic_id: isUuid(str("topic")) ? str("topic") : "",
    book: (BOOKS as readonly string[]).includes(str("book")) ? str("book") : "",
    from: isYmd(str("from")) ? str("from") : "",
    to: isYmd(str("to")) ? str("to") : "",
  };
  const filtered = Object.values(filters).some(Boolean);
  const page = Math.max(0, Number(str("page")) || 0);
  const [viewer, supabase] = await Promise.all([teachingViewer(), requireClient()]);
  const [list, latest, facetsRes] = await Promise.all([
    listItems(supabase, "lesson", filters, PAGE, page * PAGE),
    filtered || page ? Promise.resolve(null) : listItems(supabase, "lesson", {}, 1),
    supabase.rpc("media_facets", { p_kind: "lesson" }),
  ]);
  const facets = (facetsRes.data ?? { series: [], people: [], topics: [], refs: [] }) as Facets;
  const books = BOOKS.filter((b) => facets.refs.some((r) => bookOf(r) === b));
  const top = latest?.items[0] ?? null;
  const rest = list.items.filter((i) => i.id !== top?.id);
  const urls = await signPaths(supabase, [...coverPaths(top ? [top] : [], "large"), ...coverPaths(rest)]);
  const query = (p: number) => ({ query: { ...Object.fromEntries(Object.entries({ q: filters.q, series: filters.series_id, speaker: filters.person_id, topic: filters.topic_id, book: filters.book, from: filters.from, to: filters.to }).filter(([, v]) => v)), page: p } });
  const select = "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3";

  return (
    <>
      <PageHeader
        title="Sunday lessons"
        description="Watch, listen, and read lessons from Sunday gatherings."
        actions={viewer.member ? <ButtonLink href="/journal" variant="secondary" size="sm">My Journal</ButtonLink> : null}
      />
      {!viewer.member ? <div className="mb-6"><VisitorNote next="/lessons" /></div> : null}
      {!list.ok ? <Alert tone="error" title="Lessons couldn't be loaded right now." className="mb-6" /> : null}
      {top ? (
        <section aria-label="Latest lesson" className="mb-10">
          <FeaturedItem item={top} urls={urls} eyebrow="Latest lesson" />
        </section>
      ) : null}

      <section aria-labelledby="lesson-archive">
        <SectionHeading id="lesson-archive">{filtered ? "Matching lessons" : "Archive"}</SectionHeading>
        <form role="search" aria-label="Search lessons" className="mb-5 grid gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
            <label htmlFor="lq" className="block text-meta font-semibold">
              Search titles, speakers, topics, and passages
            </label>
            <input id="lq" name="q" defaultValue={filters.q} className={select} />
          </div>
          {facets.series.length ? (
            <div className="space-y-1">
              <label htmlFor="ls" className="block text-meta font-semibold">
                Series
              </label>
              <select id="ls" name="series" defaultValue={filters.series_id} className={select}>
                <option value="">Any</option>
                {facets.series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {facets.people.length ? (
            <div className="space-y-1">
              <label htmlFor="lp" className="block text-meta font-semibold">
                Speaker
              </label>
              <select id="lp" name="speaker" defaultValue={filters.person_id} className={select}>
                <option value="">Anyone</option>
                {facets.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {facets.topics.length ? (
            <div className="space-y-1">
              <label htmlFor="lt" className="block text-meta font-semibold">
                Topic
              </label>
              <select id="lt" name="topic" defaultValue={filters.topic_id} className={select}>
                <option value="">Any</option>
                {facets.topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {books.length ? (
            <div className="space-y-1">
              <label htmlFor="lb" className="block text-meta font-semibold">
                Book of the Bible
              </label>
              <select id="lb" name="book" defaultValue={filters.book} className={select}>
                <option value="">Any</option>
                {books.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor="lf" className="block text-meta font-semibold">
              From
            </label>
            <input id="lf" name="from" type="date" defaultValue={filters.from} className={select} />
          </div>
          <div className="space-y-1">
            <label htmlFor="lto" className="block text-meta font-semibold">
              To
            </label>
            <input id="lto" name="to" type="date" defaultValue={filters.to} className={select} />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="min-h-11 rounded-full bg-cta px-5 font-semibold text-on-cta hover:bg-cta-hover">
              Search
            </button>
            {filtered ? (
              <Link href="/lessons" className="inline-flex min-h-11 items-center px-3 font-semibold text-primary hover:underline">
                Clear
              </Link>
            ) : null}
          </div>
        </form>
        {rest.length ? (
          <ul className="space-y-3">
            {rest.map((i) => (
              <li key={i.id}>
                <ItemCard item={i} urls={urls} />
              </li>
            ))}
          </ul>
        ) : list.ok && !top ? (
          <EmptyState glyph="lessons" title={filtered ? "No lessons match" : "No lessons yet"}>
            {filtered ? "Try fewer filters." : "Lessons will appear here after they're published."}
          </EmptyState>
        ) : null}
        {list.total > (page + 1) * PAGE || page > 0 ? (
          <nav aria-label="Pages" className="mt-4 flex justify-between">
            {page > 0 ? (
              <Link href={query(page - 1)} className="min-h-11 px-2 font-semibold text-primary">
                Newer
              </Link>
            ) : (
              <span />
            )}
            {list.total > (page + 1) * PAGE ? (
              <Link href={query(page + 1)} className="min-h-11 px-2 font-semibold text-primary">
                Older
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
