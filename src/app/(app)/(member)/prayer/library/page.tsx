import { PenSquare, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PrayerCollectionFolder, collectionGridClass } from "@/components/prayer/collection-folder";
import { LibraryBrowser } from "@/components/prayer/library-browser";
import { LibraryCard, libraryGridClass } from "@/components/prayer/library-card";
import { LibraryFilterPanel } from "@/components/prayer/library-filters";
import { PrayerHeader } from "@/components/prayer/prayer-header";
import { PrayerTabs } from "@/components/prayer/prayer-tabs";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { segmentClass } from "@/components/ui/segmented";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { signCollectionCovers } from "@/lib/prayer/collection-covers";
import { pick } from "@/lib/prayer/format";
import {
  collectionHref,
  decodeLibraryCursor,
  encodeLibraryCursor,
  LIBRARY_VIEW_LABEL,
  PAGE_VIEW_LABEL,
  PAGE_VIEWS,
  pickCategory,
  type CollectionShelves,
  type LibraryMeta,
  type LibraryPage,
  type LibraryView,
  type PageView,
} from "@/lib/prayer/library";
import { getChurchSettings } from "@/lib/settings/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Prayer Library" };

const EMPTY: Record<LibraryView, { title: string; body: string }> = {
  library: { title: "The Prayer Library is just beginning", body: "Members' prayers for meals, gatherings, hard days, and glad ones will be gathered here. Add one you wrote or have permission to share." },
  mine: { title: "You haven't added a prayer yet", body: "Write a prayer or share one you have permission to share. You can save a draft and publish when you're ready." },
  saved: { title: "No saved prayers yet", body: "Save a prayer to keep it close. Your saved prayers are private: only you can see them." },
};

const viewHref = (v: PageView) => (v === "collections" ? "/prayer/library" : `/prayer/library?view=${v}`);

export default async function PrayerLibraryPage({ searchParams }: PageProps<"/prayer/library">) {
  await requireApprovedMember("/prayer/library");
  const sp = await searchParams;
  const pageView = pick(sp.view, PAGE_VIEWS, "collections");
  const view: LibraryView = pageView === "collections" ? "library" : pageView;
  const cursor = decodeLibraryCursor(sp.after);
  const [meta, { settings }] = await Promise.all([tryCommunityRpc<LibraryMeta>("prayer_library_meta"), getChurchSettings()]);
  const categories = meta?.categories ?? [];
  const filters =
    pageView === "collections"
      ? { topic: null, purpose: null, use: null }
      : { topic: pickCategory(sp.topic, categories, "topic"), purpose: pickCategory(sp.purpose, categories, "purpose"), use: pickCategory(sp.use, categories, "use") };
  const filtered = [filters.topic, filters.purpose, filters.use].some(Boolean);
  const [page, shelves] = await Promise.all([
    meta && pageView !== "collections"
      ? tryCommunityRpc<LibraryPage>("prayer_library_list", {
          p_view: view,
          p_query: null,
          p_topic: filters.topic,
          p_purpose: filters.purpose,
          p_use: filters.use,
          p_before: cursor?.before ?? null,
          p_before_id: cursor?.beforeId ?? null,
          p_limit: 20,
        })
      : null,
    meta && pageView === "collections" ? tryCommunityRpc<CollectionShelves>("prayer_library_collections") : null,
  ]);
  // Covers are signed with the reader's own client: storage only serves ones they may see.
  const supabase = shelves?.collections.some((c) => c.cover) ? await createClient() : null;
  const covers = supabase ? await signCollectionCovers(supabase, shelves!.collections.map((c) => c.cover?.path)) : new Map<string, string>();
  const tz = settings.timezone;
  const canAdd = !!meta;
  const href = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, ...filters, ...extra })) if (v) p.set(k, v);
    return `/prayer/library?${p}`;
  };
  const resetHref = viewHref(pageView);
  const nextCursor = page?.has_more ? encodeLibraryCursor(page.items[page.items.length - 1]) : null;

  return (
    <div className="layout-wide">
      <PrayerHeader
        description="Prayers members have written or gathered, for personal prayer, meals, small groups, and worship. Find one to pray, or share one of your own."
        action={
          canAdd ? (
            <ButtonLink href="/prayer/library/new" icon={<PenSquare className="size-4" aria-hidden="true" />}>
              Add a prayer
            </ButtonLink>
          ) : null
        }
      />
      {sp.archived ? <Alert tone="success" title="Archived. Only you can see it now." className="mb-4" /> : null}

      <div className="min-w-0 space-y-4">
        <PrayerTabs active="library" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[1.5rem] font-semibold leading-tight text-text">Prayer Library</h2>
          {/* Four short choices: one row on wider screens, two rows of two on a phone; never a sideways scroll. */}
          <nav aria-label="Library views" className="grid w-full grid-cols-2 gap-1 rounded-[1.6875rem] border border-border bg-surface-muted p-1 min-[520px]:flex min-[520px]:w-auto">
            {PAGE_VIEWS.map((v) => (
              <Link key={v} href={viewHref(v)} className={cn(segmentClass(v === pageView), "justify-center whitespace-nowrap")} aria-current={v === pageView ? "page" : undefined}>
                {PAGE_VIEW_LABEL[v]}
              </Link>
            ))}
          </nav>
        </div>

        {!meta ? (
          <Alert tone="error" title="The Prayer Library couldn't be loaded right now.">
            Please try again in a moment.
          </Alert>
        ) : pageView === "collections" ? (
          <LibraryBrowser view="library" listKey="collections" filters={filters} filtered={false} tz={tz} canAdd={canAdd}>
            {!shelves ? (
              <Alert tone="error" title="Collections couldn't be loaded right now.">
                Please try again in a moment.
              </Alert>
            ) : shelves.total > 0 ? (
              <section aria-labelledby="pl-collections" className="space-y-3">
                <h3 id="pl-collections" className="sr-only">
                  Collections
                </h3>
                <p className="text-meta text-text-secondary">Browse prayers by collection, or search every prayer above.</p>
                <ul className={collectionGridClass}>
                  <li>
                    <PrayerCollectionFolder href={viewHref("library")} collection={{ name: LIBRARY_VIEW_LABEL.library, description: "Every published prayer, newest first.", count: shelves.total }} all />
                  </li>
                  {shelves.collections.map((c) => (
                    <li key={c.id}>
                      <PrayerCollectionFolder href={collectionHref(c.id)} collection={c} src={c.cover ? covers.get(c.cover.path) : null} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <EmptyState
                glyph="prayer"
                title={EMPTY.library.title}
                action={
                  <ButtonLink href="/prayer/library/new" variant="secondary" size="sm" icon={<PenSquare className="size-4" aria-hidden="true" />}>
                    Add a prayer
                  </ButtonLink>
                }
              >
                {EMPTY.library.body}
              </EmptyState>
            )}
          </LibraryBrowser>
        ) : (
          <LibraryBrowser
            // A new filter choice starts the list (and any remembered search) over.
            key={`${view}:${filters.topic}:${filters.purpose}:${filters.use}`}
            view={view}
            filters={filters}
            filtered={filtered}
            tz={tz}
            canAdd={canAdd}
            filterPanel={<LibraryFilterPanel action="/prayer/library" hidden={{ view }} categories={categories} filters={filters} resetHref={resetHref} />}
          >
            {!page ? (
              <Alert tone="error" title="Prayers couldn't be loaded right now.">
                Please try again in a moment.
              </Alert>
            ) : page.items.length ? (
              <>
                <ul className={libraryGridClass} aria-label={LIBRARY_VIEW_LABEL[view]}>
                  {page.items.map((c) => (
                    <li key={c.id}>
                      <LibraryCard card={c} tz={tz} />
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {cursor ? (
                    <ButtonLink href={href({ after: null })} variant="ghost" size="sm">
                      Back to newest
                    </ButtonLink>
                  ) : null}
                  {nextCursor ? (
                    <ButtonLink href={href({ after: nextCursor })} variant="secondary" size="sm">
                      Show older prayers
                    </ButtonLink>
                  ) : null}
                </div>
              </>
            ) : (
              <EmptyState
                glyph="prayer"
                title={cursor ? "No older prayers" : filtered ? "No prayers match these filters" : EMPTY[view].title}
                action={
                  <>
                    {filtered ? (
                      <ButtonLink href={resetHref} variant="ghost" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />}>
                        Reset filters
                      </ButtonLink>
                    ) : null}
                    {view !== "saved" || filtered ? (
                      <ButtonLink href="/prayer/library/new" variant="secondary" size="sm" icon={<PenSquare className="size-4" aria-hidden="true" />}>
                        Add a prayer
                      </ButtonLink>
                    ) : (
                      <ButtonLink href="/prayer/library" variant="secondary" size="sm">
                        Browse the library
                      </ButtonLink>
                    )}
                  </>
                }
              >
                {filtered ? "Try another combination, or add a prayer for this need." : EMPTY[view].body}
              </EmptyState>
            )}
          </LibraryBrowser>
        )}
      </div>
    </div>
  );
}
