import { ExternalLink, Link2, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogFilters, CatalogLinkList } from "@/components/prayer/catalog-rows";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import {
  CATALOG_LINK_NOTE,
  CATALOG_PAGE,
  catalogCount,
  catalogHref,
  catalogOffset,
  catalogRange,
  pickTopic,
  type CatalogDetail,
  type CatalogLinkPage,
} from "@/lib/prayer/catalog";

// A generic title, as for prayers: nothing a reader is looking at goes into
// tab names or browser history.
export const metadata: Metadata = { title: "Prayer Library" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One prayer link catalogue, such as **Catholic Online Prayers**: the
 * source's own topics, and its prayers by title with a link out to the page
 * each one is on. The prayers' words are not held here and never shown here.
 *
 * A catalogue the church hasn't published, or one with no published link,
 * reads as not found — the database decides that (`prayer_link_catalog`), not
 * this page.
 */
export default async function PrayerCatalogPage({ params, searchParams }: PageProps<"/prayer/library/catalogs/[id]">) {
  const { id } = await params;
  await requireApprovedMember(UUID.test(id) ? catalogHref(id) : "/prayer/library");
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const catalog = await tryCommunityRpc<CatalogDetail>("prayer_link_catalog", { p_id: id });
  if (!catalog) notFound();

  const topic = pickTopic(sp.topic, catalog.topics);
  const query = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const { page: pageNo, offset } = catalogOffset(sp.page);
  const page = await tryCommunityRpc<CatalogLinkPage>("prayer_link_list", {
    p_catalog: catalog.id,
    p_query: query || null,
    p_topic: topic,
    p_limit: CATALOG_PAGE,
    p_offset: offset,
  });

  const base = catalogHref(catalog.id);
  const href = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: query || null, topic, ...extra })) if (v) p.set(k, v);
    return p.size ? `${base}?${p}` : base;
  };
  const filtered = !!topic || !!query;
  const topicName = catalog.topics.find((t) => t.id === topic)?.name ?? null;

  return (
    <div className="layout-wide">
      <BackLink route="/prayer/library/catalogs/[id]" />
      <header className="mb-6 overflow-hidden rounded-card border border-border bg-surface shadow-(--elev-card) sm:flex">
        <div className="relative flex h-32 shrink-0 items-center justify-center bg-primary-soft sm:h-auto sm:w-48" aria-hidden="true">
          <Link2 className="size-14 text-primary/80" strokeWidth={1.4} />
        </div>
        <div className="min-w-0 space-y-1.5 p-5">
          <p className="text-meta font-semibold uppercase tracking-wide text-text-secondary">Prayers from another source</p>
          <h1 className="font-display text-[1.75rem] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-[2rem]">{catalog.name}</h1>
          {catalog.description ? <p className="text-text-secondary">{catalog.description}</p> : null}
          <p className="text-meta font-semibold text-text-secondary">
            {catalogCount(catalog.count)} · {catalog.topics.length.toLocaleString("en-US")} {catalog.topics.length === 1 ? "topic" : "topics"}
          </p>
          <p className="text-meta text-text-secondary">
            Each prayer opens on{" "}
            <a href={catalog.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
              {catalog.source_name}
              <ExternalLink className="ml-1 inline size-3.5 align-text-top" aria-hidden="true" />
            </a>
            . {CATALOG_LINK_NOTE}
          </p>
          {catalog.rights_statement ? <p className="text-meta text-text-secondary">{catalog.rights_statement}</p> : null}
        </div>
      </header>

      <div className="min-w-0 space-y-4">
        <CatalogFilters action={base} topics={catalog.topics} topic={topic} query={query} resetHref={base} />

        {!page ? (
          <Alert tone="error" title="These prayers couldn't be loaded right now.">
            Please try again in a moment.
          </Alert>
        ) : page.items.length ? (
          <>
            <p role="status" className="text-meta text-text-secondary">
              {catalogRange(page.total, offset, page.items.length)}
              {topicName ? ` in ${topicName}` : ""}
              {query ? ` matching “${query}”` : ""}
            </p>
            <CatalogLinkList items={page.items} label={`Prayers in ${catalog.name}`} />
            <div className="flex flex-wrap gap-2">
              {pageNo > 1 ? (
                <ButtonLink href={href({ page: pageNo > 2 ? String(pageNo - 1) : null })} variant="secondary" size="sm">
                  Previous prayers
                </ButtonLink>
              ) : null}
              {page.has_more ? (
                <ButtonLink href={href({ page: String(pageNo + 1) })} variant="secondary" size="sm">
                  More prayers
                </ButtonLink>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyState
            glyph="prayer"
            title={filtered ? "No prayers here match that" : pageNo > 1 ? "No more prayers" : "No prayers in this category yet"}
            action={
              filtered ? (
                <ButtonLink href={base} variant="ghost" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />}>
                  Clear search and topic
                </ButtonLink>
              ) : (
                <ButtonLink href="/prayer/library" variant="secondary" size="sm">
                  Back to the Prayer Library
                </ButtonLink>
              )
            }
          >
            {filtered ? "Try fewer or different words, or another topic." : "Nothing has been published here yet."}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
