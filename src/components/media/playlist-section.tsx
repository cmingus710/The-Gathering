import { Music2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { spotifyEmbed } from "@/lib/media/embeds";
import type { ItemCard } from "@/lib/media/types";
import { EmbedPlayer } from "./embed-player";
import { BookmarkButton } from "./toggles";

/**
 * One playlist on the Music page: title, the administrator's description,
 * and the official Spotify player (from the validated playlist ID) with the
 * member's Save button and an "Open in Spotify" fallback.
 */
export function PlaylistSection({ item, first }: { item: ItemCard; first: boolean }) {
  const headingId = `pl-${item.id}`;
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-(--elev-card) sm:p-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="font-display text-xl font-semibold leading-snug text-text text-balance">
            {item.title}
          </h2>
          {item.featured ? <Badge tone="info">Featured</Badge> : null}
        </div>
        {item.summary ? <p className="max-w-[65ch] text-text-secondary">{item.summary}</p> : null}
      </div>
      {item.spotify_id ? (
        <EmbedPlayer
          autoload
          eager={first}
          title={`${item.title} on Spotify`}
          embed={spotifyEmbed({ provider: "spotify", kind: "playlist", id: item.spotify_id })}
          actions={<BookmarkButton type="item" id={item.id} saved={item.bookmarked} label={item.title} />}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 rounded-tile bg-surface-muted px-4 py-3 text-meta text-text-secondary">
            <Music2 className="size-4 shrink-0" aria-hidden="true" />
            This playlist&apos;s Spotify player isn&apos;t available right now.
          </p>
          <BookmarkButton type="item" id={item.id} saved={item.bookmarked} label={item.title} />
        </div>
      )}
    </section>
  );
}
