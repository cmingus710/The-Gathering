import type { Metadata } from "next";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { ItemCard } from "@/components/media/item-card";
import { ExternalEpisodeCard, ShowCard, showArtPaths } from "@/components/media/podcast";
import { VideoCard } from "@/components/media/video-card";
import { VisitorNote } from "@/components/media/visitor-note";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { coverPaths, formatDay } from "@/lib/media/format";
import { signPaths } from "@/lib/media/storage";
import type { ExternalEpisode, ItemCard as Card, Show } from "@/lib/media/types";
import { teachingViewer } from "@/lib/media/viewer";
import type { IconName } from "@/lib/icons";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Teaching & media" };

type Hit = (Card & { type: "item" }) | (Show & { type: "show" }) | (ExternalEpisode & { type: "external" }) | { type: "album"; id: string; title: string; album_on: string | null };

const SECTIONS: Array<{ href: string; label: string; glyph: IconName; members?: boolean }> = [
  { href: "/devotionals", label: "Devotionals", glyph: "devotionals" },
  { href: "/lessons", label: "Sunday lessons", glyph: "lessons" },
  { href: "/videos", label: "Videos", glyph: "media", members: true },
  { href: "/podcasts", label: "Podcasts", glyph: "podcasts" },
  { href: "/reading", label: "Books", glyph: "reading", members: true },
  { href: "/music", label: "Music & playlists", glyph: "music", members: true },
  { href: "/gallery", label: "Media gallery", glyph: "gallery", members: true },
];

/** Content-type filters for search (media_search p_kind); members-only types are hidden from visitors. */
const TYPES: Array<{ value: string; label: string; members?: boolean }> = [
  { value: "", label: "All" },
  { value: "video", label: "Videos", members: true },
  { value: "devotional", label: "Devotionals" },
  { value: "lesson", label: "Sunday lessons" },
  { value: "podcast", label: "Podcasts" },
  { value: "reading", label: "Books", members: true },
  { value: "music", label: "Music", members: true },
  { value: "gallery", label: "Media gallery", members: true },
];

/**
 * The teaching hub: every section, search across what the viewer may see
 * (teaching, videos, podcasts, and for members album titles; never prayer,
 * care, messages, giving, or journals) with a content-type filter, and the
 * member's own "continue listening". Video results play in place.
 */
export default async function MediaHubPage({ searchParams }: PageProps<"/media">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const [viewer, supabase, { settings }] = await Promise.all([teachingViewer(), requireClient(), getChurchSettings()]);
  const types = TYPES.filter((t) => viewer.member || !t.members);
  const type = types.some((t) => t.value === sp.type) ? (sp.type as string) : "";
  const [search, cont] = await Promise.all([
    // Without a type the call matches the database before 20261109000200 too.
    q.length >= 2 ? supabase.rpc("media_search", type ? { p_q: q, p_limit: 40, p_kind: type } : { p_q: q, p_limit: 40 }) : Promise.resolve(null),
    viewer.member && !q ? supabase.rpc("media_continue") : Promise.resolve(null),
  ]);
  const hits = (search?.data ?? []) as Hit[];
  const resume = (cont?.data ?? []) as Card[];
  const items = hits.filter((h): h is Card & { type: "item" } => h.type === "item");
  const shows = hits.filter((h): h is Show & { type: "show" } => h.type === "show");
  const urls = await signPaths(supabase, [
    ...coverPaths(items.filter((i) => i.kind !== "video")),
    ...coverPaths(items.filter((i) => i.kind === "video"), "large"),
    ...coverPaths(resume),
    ...showArtPaths(shows),
  ]);
  const typeHref = (t: string) => ({ pathname: "/media", query: { q, ...(t ? { type: t } : {}) } });

  return (
    <>
      <PageHeader title="Teaching & media" description="Devotionals, Sunday lessons, videos, podcasts, reading, music, and the Media gallery in one place." />
      {!viewer.member ? <div className="mb-6"><VisitorNote next="/media" /></div> : null}

      <nav aria-label="Sections" className="mb-8">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-3 sm:grid-cols-3">
          {SECTIONS.filter((s) => viewer.member || !s.members).map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="interactive flex min-h-16 flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-3 font-semibold hover:bg-surface-muted/60">
                <TileIcon name={s.glyph} className="size-10" />
                {/* Moves below the icon only when it can't fit beside it (large text). */}
                <span className="min-w-0 flex-1 basis-14">{s.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form role="search" aria-label="Search teaching and media" className="mb-8 flex gap-2">
        <label htmlFor="mq" className="sr-only">
          Search teaching and media
        </label>
        <input
          id="mq"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by title, speaker, topic, or passage"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-border-strong bg-surface px-3"
        />
        {type ? <input type="hidden" name="type" value={type} /> : null}
        <button type="submit" className="min-h-11 rounded-full bg-cta px-5 font-semibold text-on-cta hover:bg-cta-hover">
          Search
        </button>
      </form>

      {q ? (
        <section aria-labelledby="hub-results" aria-live="polite">
          <SectionHeading id="hub-results">Results for “{q}”</SectionHeading>
          <nav aria-label="Show only" className="-mt-1 mb-4 flex gap-2 overflow-x-auto pb-1">
            {types.map((t) => (
              <Link
                key={t.value || "all"}
                href={typeHref(t.value)}
                aria-current={type === t.value ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-meta font-semibold",
                  type === t.value ? "border-text bg-text text-background" : "border-border bg-surface hover:bg-surface-muted",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {search?.error ? <Alert tone="error" title="Search isn't available right now." /> : null}
          {q.length < 2 ? <p className="text-text-secondary">Type at least two letters.</p> : null}
          {q.length >= 2 && !search?.error && !hits.length ? <EmptyState glyph="media" title="Nothing found">Try another word or a passage like “John 3”.</EmptyState> : null}
          <ul className="space-y-3">
            {hits.map((h) => (
              <li key={`${h.type}:${h.id}`}>
                {h.type === "item" && h.kind === "video" ? (
                  <VideoCard item={h} urls={urls} />
                ) : h.type === "item" ? (
                  <ItemCard item={h} urls={urls} showKind />
                ) : h.type === "show" ? (
                  <ShowCard show={h} urls={urls} />
                ) : h.type === "external" ? (
                  <ExternalEpisodeCard episode={h} timeZone={settings.timezone} />
                ) : (
                  <Link href={`/gallery/${h.id}`} className="interactive flex items-center gap-3.5 rounded-card border border-border bg-surface p-3 hover:bg-surface-muted/60">
                    <span className="flex size-20 shrink-0 items-center justify-center rounded-tile bg-surface-muted" aria-hidden="true">
                      <TileIcon name="gallery" className="size-12" />
                    </span>
                    <span>
                      <span className="block text-[0.8125rem] font-semibold text-text-secondary">{["Media gallery album", h.album_on ? formatDay(h.album_on, "short") : null].filter(Boolean).join(" · ")}</span>
                      <span className="block font-semibold">{h.title}</span>
                    </span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : resume.length ? (
        <section aria-labelledby="hub-continue">
          <SectionHeading id="hub-continue" description="Only you can see this.">
            Continue listening and watching
          </SectionHeading>
          <ul className="space-y-3">
            {resume.map((i) => (
              <li key={i.id}>
                <ItemCard item={i} urls={urls} showKind />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
