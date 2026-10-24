import { ChevronDown, PenSquare, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LibraryBrowser } from "@/components/prayer/library-browser";
import { LibraryCard, libraryGridClass } from "@/components/prayer/library-card";
import { PrayerHeader } from "@/components/prayer/prayer-header";
import { PrayerTabs } from "@/components/prayer/prayer-tabs";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { segmentClass } from "@/components/ui/segmented";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { pick } from "@/lib/prayer/format";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  KIND_LABEL,
  KINDS,
  LIBRARY_VIEW_LABEL,
  LIBRARY_VIEWS,
  pickCategory,
  type CategoryKind,
  type LibraryMeta,
  type LibraryPage,
  type LibraryView,
} from "@/lib/prayer/library";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Prayer Library" };

const EMPTY: Record<LibraryView, { title: string; body: string }> = {
  library: { title: "The Prayer Library is just beginning", body: "Members' prayers for meals, gatherings, hard days, and glad ones will be gathered here. Add one you wrote or have permission to share." },
  mine: { title: "You haven't added a prayer yet", body: "Write a prayer or share one you have permission to share. You can save a draft and publish when you're ready." },
  saved: { title: "No saved prayers yet", body: "Save a prayer to keep it close. Your saved prayers are private: only you can see them." },
};

const ANY: Record<CategoryKind, string> = { topic: "Any topic", purpose: "Any purpose", use: "Any use" };

export default async function PrayerLibraryPage({ searchParams }: PageProps<"/prayer/library">) {
  await requireApprovedMember("/prayer/library");
  const sp = await searchParams;
  const view = pick(sp.view, LIBRARY_VIEWS, "library");
  const cursor = decodeLibraryCursor(sp.after);
  const [meta, { settings }] = await Promise.all([tryCommunityRpc<LibraryMeta>("prayer_library_meta"), getChurchSettings()]);
  const categories = meta?.categories ?? [];
  const filters = { topic: pickCategory(sp.topic, categories, "topic"), purpose: pickCategory(sp.purpose, categories, "purpose"), use: pickCategory(sp.use, categories, "use") };
  const activeCount = [filters.topic, filters.purpose, filters.use].filter(Boolean).length;
  const filtered = activeCount > 0;
  const page = meta
    ? await tryCommunityRpc<LibraryPage>("prayer_library_list", {
        p_view: view,
        p_query: null,
        p_topic: filters.topic,
        p_purpose: filters.purpose,
        p_use: filters.use,
        p_before: cursor?.before ?? null,
        p_before_id: cursor?.beforeId ?? null,
        p_limit: 20,
      })
    : null;
  const tz = settings.timezone;
  const canAdd = !!meta;
  const href = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ view: view === "library" ? null : view, ...filters, ...extra })) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/prayer/library?${qs}` : "/prayer/library";
  };
  const resetHref = view === "library" ? "/prayer/library" : `/prayer/library?view=${view}`;
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
          <nav aria-label="Library views" className="flex max-w-full overflow-x-auto rounded-full border border-border bg-surface-muted p-1">
            {LIBRARY_VIEWS.map((v) => (
              <Link
                key={v}
                href={v === "library" ? "/prayer/library" : `/prayer/library?view=${v}`}
                className={cn(segmentClass(v === view), "shrink-0 whitespace-nowrap")}
                aria-current={v === view ? "page" : undefined}
              >
                {LIBRARY_VIEW_LABEL[v]}
              </Link>
            ))}
          </nav>
        </div>

        {!meta ? (
          <Alert tone="error" title="The Prayer Library couldn't be loaded right now.">
            Please try again in a moment.
          </Alert>
        ) : (
          <>
            <LibraryBrowser
              view={view}
              filters={filters}
              filtered={filtered}
              tz={tz}
              canAdd={canAdd}
              filterPanel={
                <details open={filtered} className="group rounded-card border border-border bg-surface shadow-(--elev-card)">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-card px-4 font-semibold focus-visible:outline-3 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                    <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
                    <span>Filters</span>
                    <span className="text-meta font-normal text-text-secondary">
                      {activeCount ? `${activeCount} applied` : "Topic, purpose, intended use"}
                    </span>
                    <ChevronDown className="ml-auto size-4 text-text-secondary transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <form method="get" action="/prayer/library" aria-label="Filter prayers" className="border-t border-border p-4">
                    {view !== "library" ? <input type="hidden" name="view" value={view} /> : null}
                    <div className="grid gap-3 sm:grid-cols-3">
                      {KINDS.map((kind) => (
                        <label key={kind} className="space-y-1 text-meta font-semibold">
                          <span className="block">{KIND_LABEL[kind]}</span>
                          <select name={kind} defaultValue={filters[kind] ?? ""} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-base">
                            <option value="">{ANY[kind]}</option>
                            {categories
                              .filter((c) => c.kind === kind)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="submit" className="min-h-11 rounded-full border border-border-strong bg-surface px-4 text-meta font-semibold hover:bg-surface-muted">
                        Apply filters
                      </button>
                      {filtered ? (
                        <ButtonLink href={resetHref} variant="ghost" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />}>
                          Reset filters
                        </ButtonLink>
                      ) : null}
                    </div>
                  </form>
                </details>
              }
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
          </>
        )}
      </div>
    </div>
  );
}
