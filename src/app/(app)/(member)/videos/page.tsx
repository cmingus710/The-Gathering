import type { Metadata } from "next";
import Link from "next/link";
import { VideoCard } from "@/components/media/video-card";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { coverPaths, isUuid } from "@/lib/media/format";
import { listItems } from "@/lib/media/pages";
import { signPaths } from "@/lib/media/storage";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Videos" };

type Facets = { topics: Array<{ id: string; name: string }> };

const PAGE = 12;

/**
 * Browse published videos without a search term: newest first, filtered by
 * topic or words. Each card plays in place; only thumbnails load until a
 * member presses Play. Videos appear here only after a publisher publishes
 * them for members (or a group); library files alone never do.
 */
export default async function VideosPage({ searchParams }: PageProps<"/videos">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filters = { q: str("q").trim().slice(0, 80), topic_id: isUuid(str("topic")) ? str("topic") : "" };
  const filtered = Boolean(filters.q || filters.topic_id);
  const page = Math.max(0, Math.floor(Number(str("page")) || 0));
  const supabase = await requireClient();
  const [, list, facetsRes] = await Promise.all([
    requireApprovedMember("/videos"),
    listItems(supabase, "video", filters, PAGE, page * PAGE),
    supabase.rpc("media_facets", { p_kind: "video" }),
  ]);
  const topics = ((facetsRes.data ?? { topics: [] }) as Facets).topics;
  const urls = await signPaths(supabase, coverPaths(list.items, "large"));
  const query = (p: number) => ({ query: { ...Object.fromEntries(Object.entries({ q: filters.q, topic: filters.topic_id }).filter(([, v]) => v)), page: p } });
  const field = "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3";

  return (
    <>
      <PageHeader title="Videos" description="Teaching and church videos. Press Play to watch right here." />
      <form role="search" aria-label="Filter videos" className="mb-6 grid gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor="vq" className="block text-meta font-semibold">
            Search titles, descriptions, topics, and tags
          </label>
          <input id="vq" name="q" type="search" defaultValue={filters.q} className={field} />
        </div>
        {topics.length ? (
          <div className="space-y-1">
            <label htmlFor="vt" className="block text-meta font-semibold">
              Topic
            </label>
            <select id="vt" name="topic" defaultValue={filters.topic_id} className={field}>
              <option value="">Any</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="submit" className="min-h-11 rounded-full bg-cta px-5 font-semibold text-on-cta hover:bg-cta-hover">
            Show
          </button>
          {filtered ? (
            <Link href="/videos" className="inline-flex min-h-11 items-center rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <section aria-labelledby="videos-list">
        <SectionHeading id="videos-list" description={list.total ? `${list.total} video${list.total === 1 ? "" : "s"}` : undefined}>
          {filtered ? "Matching videos" : "Latest videos"}
        </SectionHeading>
        {!list.ok ? <Alert tone="error" title="Videos couldn't be loaded right now." className="mb-6" /> : null}
        {list.ok && !list.items.length ? (
          <EmptyState glyph="media" title={filtered ? "No matching videos" : "No videos yet"}>
            {filtered ? "Try another word or topic." : "Videos will appear here when the church publishes them."}
          </EmptyState>
        ) : null}
        <ul className="grid gap-4 md:grid-cols-2">
          {list.items.map((item) => (
            <li key={item.id}>
              <VideoCard item={item} urls={urls} />
            </li>
          ))}
        </ul>
        {list.total > PAGE ? (
          <nav aria-label="More videos" className="mt-6 flex justify-between gap-2">
            {page > 0 ? (
              <Link href={{ pathname: "/videos", ...query(page - 1) }} className="inline-flex min-h-11 items-center rounded-full px-4 font-semibold text-primary hover:bg-primary-soft">
                Newer
              </Link>
            ) : (
              <span />
            )}
            {(page + 1) * PAGE < list.total ? (
              <Link href={{ pathname: "/videos", ...query(page + 1) }} className="inline-flex min-h-11 items-center rounded-full px-4 font-semibold text-primary hover:bg-primary-soft">
                Older
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
