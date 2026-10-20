import type { Metadata } from "next";
import { EpisodeList, ShowCard, showArtPaths } from "@/components/media/podcast";
import { VisitorNote } from "@/components/media/visitor-note";
import { Alert } from "@/components/ui/alert";
import { EmptyState, SectionHeading } from "@/components/ui/card";
import { SectionHero } from "@/components/ui/section-hero";
import { coverPaths } from "@/lib/media/format";
import { signPaths } from "@/lib/media/storage";
import type { EpisodeEntry, ItemCard, Show } from "@/lib/media/types";
import { teachingViewer } from "@/lib/media/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Podcasts" };

export default async function PodcastsPage() {
  const [viewer, supabase, { settings }] = await Promise.all([teachingViewer(), requireClient(), getChurchSettings()]);
  const { data, error } = await supabase.rpc("media_shows");
  const { shows, recent } = (data ?? { shows: [], recent: [] }) as { shows: Show[]; recent: EpisodeEntry[] };
  const featured = shows.filter((s) => s.featured);
  const others = shows.filter((s) => !s.featured);
  const church = recent.filter((e): e is ItemCard & { type: "church" } => e.type === "church");
  const urls = await signPaths(supabase, [...showArtPaths(shows), ...coverPaths(church)]);

  return (
    <>
      <SectionHero art="podcasts" glyph="podcasts" title="Podcasts" description="Shows from our church and others we recommend." />
      {!viewer.member ? <div className="mb-6"><VisitorNote next="/podcasts" /></div> : null}
      {error ? <Alert tone="error" title="Podcasts couldn't be loaded right now." className="mb-6" /> : null}
      {!error && !shows.length ? (
        <EmptyState glyph="podcasts" title="No podcasts yet">
          Shows will appear here after they&apos;re published.
        </EmptyState>
      ) : null}

      {featured.length ? (
        <section aria-labelledby="pod-featured" className="mb-8">
          <SectionHeading id="pod-featured">Featured</SectionHeading>
          <ul className="grid gap-3 sm:grid-cols-2">
            {featured.map((s) => (
              <li key={s.id}>
                <ShowCard show={s} urls={urls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length ? (
        <section aria-labelledby="pod-recent" className="mb-8">
          <SectionHeading id="pod-recent">Recent episodes</SectionHeading>
          <EpisodeList entries={recent} urls={urls} timeZone={settings.timezone} />
        </section>
      ) : null}

      {others.length ? (
        <section aria-labelledby="pod-all">
          <SectionHeading id="pod-all">{featured.length ? "More shows" : "Shows"}</SectionHeading>
          <ul className="grid gap-3 sm:grid-cols-2">
            {others.map((s) => (
              <li key={s.id}>
                <ShowCard show={s} urls={urls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
