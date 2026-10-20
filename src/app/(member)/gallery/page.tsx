/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import type { Metadata } from "next";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { SectionHero } from "@/components/ui/section-hero";
import { formatDay } from "@/lib/media/format";
import { signPaths } from "@/lib/media/storage";
import type { Album } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Photo galleries" };

export default async function GalleryPage() {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_albums");
  const albums = (data ?? []) as Album[];
  const urls = await signPaths(supabase, albums.map((a) => a.cover?.thumb_path));
  return (
    <>
      <SectionHero art="gallery" glyph="gallery"
        title="Photo galleries"
        description="Photos from church life, shared with members. Never public."
        actions={
          <ButtonLink href="/gallery/mine" variant="secondary" size="sm">
            My photos
          </ButtonLink>
        }
      />
      {error ? <Alert tone="error" title="Albums couldn't be loaded right now." className="mb-6" /> : null}
      {!error && !albums.length ? (
        <EmptyState glyph="gallery" title="No albums yet">
          Albums will appear here when the church shares them.
        </EmptyState>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {albums.map((a) => {
          const cover = a.cover ? urls.get(a.cover.thumb_path) : null;
          return (
            <li key={a.id}>
              <Link href={`/gallery/${a.id}`} className="interactive block overflow-hidden rounded-card border border-border bg-surface hover:bg-surface-muted/40">
                {cover ? (
                  <img src={cover} alt="" className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <span className="flex aspect-[4/3] items-center justify-center bg-surface-muted" aria-hidden="true">
                    <TileIcon name="gallery" className="size-16" />
                  </span>
                )}
                <span className="block p-4">
                  <span className="block font-semibold">{a.title}</span>
                  <span className="block text-meta text-text-secondary">
                    {[a.album_on ? formatDay(a.album_on, "short") : null, `${a.photo_count} ${a.photo_count === 1 ? "photo" : "photos"}`, a.audience === "group" ? a.group_name ?? "One group" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-8 text-meta text-text-secondary">
        Only signed-in members (or the album&apos;s group) can open these photos, but anyone who can see a photo can still screenshot or photograph their screen.
        Please share only photos people are happy to have seen.
      </p>
    </>
  );
}
