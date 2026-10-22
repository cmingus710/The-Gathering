import type { Metadata } from "next";
import Link from "next/link";
import { PlaylistSection } from "@/components/media/playlist-section";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { listItems } from "@/lib/media/pages";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Music & playlists" };

/** Playlists shown at first, and added by each "Show more". */
const STEP = 8;
/** The most the list function returns in one call. */
const MAX = 60;

/**
 * Every published playlist the member can see, each with its Spotify player
 * on the page (no detail page needed; /music/<id> still works for saved and
 * shared links). The database applies status, schedule, expiry, and
 * audience; featured playlists come first, as before.
 */
export default async function MusicPage({ searchParams }: PageProps<"/music">) {
  const sp = await searchParams;
  const requested = Math.floor(Number(sp.show) || STEP);
  const show = Math.min(Math.max(requested, STEP), MAX);
  const supabase = await requireClient();
  // The member check also runs here (not only in the section layout, which a
  // prefetch may have rendered earlier), alongside the read-only query.
  const [, list] = await Promise.all([requireApprovedMember("/music"), listItems(supabase, "playlist", {}, MAX)]);
  const ordered = [...list.items.filter((i) => i.featured), ...list.items.filter((i) => !i.featured)];
  const visible = ordered.slice(0, show);
  const more = ordered.length > show;

  return (
    <>
      <PageHeader title="Music & playlists" description="Worship sets and playlists from our church." />
      {!list.ok ? <Alert tone="error" title="Playlists couldn't be loaded right now." className="mb-6" /> : null}
      {list.ok && !visible.length ? (
        <EmptyState glyph="music" title="No playlists yet">
          Playlists will appear here after they&apos;re shared.
        </EmptyState>
      ) : null}
      {visible.length ? (
        <div className="mx-auto max-w-3xl space-y-6">
          <p className="text-meta text-text-secondary">Playback is provided by Spotify. Availability may depend on your Spotify account and device.</p>
          {visible.map((item, i) => (
            <PlaylistSection key={item.id} item={item} first={i === 0} />
          ))}
        </div>
      ) : null}
      {more ? (
        <p className="mt-6 text-center">
          <Link
            href={{ query: { show: show + STEP } }}
            scroll={false}
            className="inline-flex min-h-11 items-center rounded-full border border-border-strong/60 px-5 font-semibold hover:bg-surface-muted"
          >
            Show more playlists
          </Link>
        </p>
      ) : null}
      {list.total > MAX && !more ? (
        <p className="mt-6 text-center text-meta text-text-secondary">Showing the {MAX} most recent playlists.</p>
      ) : null}
    </>
  );
}
