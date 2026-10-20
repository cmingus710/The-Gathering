import type { Metadata } from "next";
import { ItemCard } from "@/components/media/item-card";
import { Alert } from "@/components/ui/alert";
import { EmptyState, SectionHeading } from "@/components/ui/card";
import { SectionHero } from "@/components/ui/section-hero";
import { coverPaths } from "@/lib/media/format";
import { listItems } from "@/lib/media/pages";
import { signPaths } from "@/lib/media/storage";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Music & playlists" };

export default async function MusicPage() {
  const supabase = await requireClient();
  const list = await listItems(supabase, "playlist", {}, 50);
  const featured = list.items.filter((i) => i.featured);
  const rest = list.items.filter((i) => !i.featured);
  const urls = await signPaths(supabase, coverPaths(list.items));
  return (
    <>
      <SectionHero art="music" glyph="music" title="Music & playlists" description="Worship sets and playlists from our church, on Spotify." />
      <p className="mb-6 rounded-tile bg-surface-muted px-4 py-3 text-meta text-text-secondary">
        Playlists play through Spotify. Without a Spotify login in this browser you may hear 30-second previews, and full playback depends on your Spotify
        account. Playlists are hosted by Spotify, so anyone with a playlist&apos;s Spotify link can open it there.
      </p>
      {!list.ok ? <Alert tone="error" title="Playlists couldn't be loaded right now." className="mb-6" /> : null}
      {list.ok && !list.items.length ? (
        <EmptyState glyph="music" title="No playlists yet">
          Playlists will appear here after they&apos;re shared.
        </EmptyState>
      ) : null}
      {featured.length ? (
        <section aria-labelledby="mu-featured" className="mb-8">
          <SectionHeading id="mu-featured">Featured</SectionHeading>
          <ul className="space-y-3">
            {featured.map((i) => (
              <li key={i.id}>
                <ItemCard item={i} urls={urls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rest.length ? (
        <section aria-labelledby="mu-all">
          {featured.length ? <SectionHeading id="mu-all">All playlists</SectionHeading> : null}
          <ul className="space-y-3">
            {rest.map((i) => (
              <li key={i.id}>
                <ItemCard item={i} urls={urls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
