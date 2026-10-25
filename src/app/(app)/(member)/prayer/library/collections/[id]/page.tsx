import { HandHeart, PenSquare, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LibraryBrowser } from "@/components/prayer/library-browser";
import { LibraryCard, libraryGridClass } from "@/components/prayer/library-card";
import { LibraryFilterPanel } from "@/components/prayer/library-filters";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { signCollectionCovers } from "@/lib/prayer/collection-covers";
import {
  collectionHref,
  decodeLibraryCursor,
  encodeLibraryCursor,
  pickCategory,
  prayerCount,
  type CollectionShelf,
  type LibraryMeta,
  type LibraryPage,
} from "@/lib/prayer/library";
import { getChurchSettings } from "@/lib/settings/queries";
import { createClient } from "@/lib/supabase/server";

// A generic title, as for prayers: collection names stay out of tab names and history.
export const metadata: Metadata = { title: "Prayer Library" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One Prayer Library collection: its cover, name, description, and published
 * prayers, newest first, with search (this collection or every prayer) and
 * the topic, purpose, and use filters. Archived collections, and ones with no
 * published prayer the reader can open, read as not found.
 */
export default async function PrayerCollectionPage({ params, searchParams }: PageProps<"/prayer/library/collections/[id]">) {
  const { id } = await params;
  await requireApprovedMember(UUID.test(id) ? collectionHref(id) : "/prayer/library");
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const [collection, meta, { settings }] = await Promise.all([
    tryCommunityRpc<CollectionShelf>("prayer_library_collection", { p_id: id }),
    tryCommunityRpc<LibraryMeta>("prayer_library_meta"),
    getChurchSettings(),
  ]);
  if (!collection) notFound();
  const categories = meta?.categories ?? [];
  const filters = { topic: pickCategory(sp.topic, categories, "topic"), purpose: pickCategory(sp.purpose, categories, "purpose"), use: pickCategory(sp.use, categories, "use") };
  const filtered = [filters.topic, filters.purpose, filters.use].some(Boolean);
  const cursor = decodeLibraryCursor(sp.after);
  const page = await tryCommunityRpc<LibraryPage>("prayer_library_list", {
    p_view: "library",
    p_query: null,
    p_topic: filters.topic,
    p_purpose: filters.purpose,
    p_use: filters.use,
    p_before: cursor?.before ?? null,
    p_before_id: cursor?.beforeId ?? null,
    p_limit: 20,
    p_collection: collection.id,
  });
  const supabase = collection.cover ? await createClient() : null;
  const cover = supabase && collection.cover ? (await signCollectionCovers(supabase, [collection.cover.path])).get(collection.cover.path) : null;
  const base = collectionHref(collection.id);
  const href = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, v);
    return p.size ? `${base}?${p}` : base;
  };
  const nextCursor = page?.has_more ? encodeLibraryCursor(page.items[page.items.length - 1]) : null;
  const tz = settings.timezone;

  return (
    <div className="layout-wide">
      <BackLink route="/prayer/library/collections/[id]" />
      <header className="mb-6 overflow-hidden rounded-card border border-border bg-surface shadow-(--elev-card) sm:flex">
        <div className="relative h-36 shrink-0 bg-primary-soft sm:h-auto sm:w-56" aria-hidden={cover ? undefined : true}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
            <img src={cover} alt={collection.cover?.alt ?? ""} className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center">
              <HandHeart className="size-14 text-primary/80" strokeWidth={1.4} />
            </span>
          )}
        </div>
        <div className="min-w-0 space-y-1.5 p-5">
          <p className="text-meta font-semibold uppercase tracking-wide text-text-secondary">Prayer collection</p>
          <h1 className="font-display text-[1.75rem] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-[2rem]">{collection.name}</h1>
          {collection.description ? <p className="text-text-secondary">{collection.description}</p> : null}
          <p className="text-meta font-semibold text-text-secondary">{prayerCount(collection.count)}</p>
          {meta ? (
            <div className="pt-1">
              <ButtonLink href={`/prayer/library/new?${new URLSearchParams({ collection: collection.id })}`} variant="secondary" size="sm" icon={<PenSquare className="size-4" aria-hidden="true" />}>
                Add a prayer to this collection
              </ButtonLink>
            </div>
          ) : null}
        </div>
      </header>

      <LibraryBrowser
        key={`${filters.topic}:${filters.purpose}:${filters.use}`}
        view="library"
        collection={{ id: collection.id, name: collection.name }}
        filters={filters}
        filtered={filtered}
        tz={tz}
        canAdd={!!meta}
        filterPanel={meta ? <LibraryFilterPanel action={base} categories={categories} filters={filters} resetHref={base} /> : null}
      >
        {!page ? (
          <Alert tone="error" title="Prayers couldn't be loaded right now.">
            Please try again in a moment.
          </Alert>
        ) : page.items.length ? (
          <>
            <ul className={libraryGridClass} aria-label={`Prayers in ${collection.name}`}>
              {page.items.map((c) => (
                <li key={c.id}>
                  <LibraryCard card={c} tz={tz} fromCollection={collection.id} />
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
            title={cursor ? "No older prayers" : "No prayers in this collection match these filters"}
            action={
              filtered ? (
                <ButtonLink href={base} variant="ghost" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />}>
                  Reset filters
                </ButtonLink>
              ) : null
            }
          >
            Try another combination, or search all prayers.
          </EmptyState>
        )}
      </LibraryBrowser>
    </div>
  );
}
