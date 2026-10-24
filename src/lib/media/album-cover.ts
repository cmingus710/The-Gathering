import type { AlbumCover } from "./types";

/**
 * Album covers are shown at 4:3 everywhere (member cards, the album header,
 * and the editor's cropper), so the framing chosen in the cropper is exactly
 * what members see.
 */
export const ALBUM_COVER_ASPECT = 4 / 3;

/** Whether the cover was set for this album (an upload or a chosen photo), not picked automatically. */
export const isChosenCover = (c: AlbumCover | null | undefined): c is AlbumCover => c?.source === "upload" || c?.source === "photo";

/**
 * The stored file to sign for a cover. Cards use the small copy unless the
 * crop is zoomed in far enough to need the large one; the header always
 * uses the large one. Video stills come from /api/media/<asset>/thumb.
 */
export function albumCoverPath(c: AlbumCover | null | undefined, use: "card" | "header"): string | null {
  if (!c || c.source === "video") return null;
  if (use === "header") return c.display_path ?? c.thumb_path;
  const zoom = c.framing?.zoom ?? 1;
  // Uploaded covers keep a 960px card copy; gallery thumbnails are 480px.
  const limit = c.source === "upload" ? 1.6 : 1;
  return (zoom > limit ? c.display_path : null) ?? c.thumb_path ?? c.display_path;
}

/** The URL of a video-only album's still (access-checked by the route), or null. */
export const albumVideoStill = (c: AlbumCover | null | undefined) => (c?.source === "video" && c.video_asset_id ? `/api/media/${c.video_asset_id}/thumb` : null);
