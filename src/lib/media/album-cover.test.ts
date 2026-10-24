import { describe, expect, it } from "vitest";
import { albumCoverPath, albumVideoStill, isChosenCover } from "./album-cover";
import type { AlbumCover } from "./types";

const cover = (over: Partial<AlbumCover>): AlbumCover => ({
  source: "upload",
  photo_id: null,
  thumb_path: "album-covers/a/u/x-thumb.webp",
  display_path: "album-covers/a/u/x-display.webp",
  alt: "",
  framing: null,
  ...over,
});

describe("album covers", () => {
  it("uses the card copy unless the crop is zoomed far in", () => {
    expect(albumCoverPath(cover({}), "card")).toBe("album-covers/a/u/x-thumb.webp");
    expect(albumCoverPath(cover({ framing: { x: 50, y: 50, zoom: 1.5 } }), "card")).toBe("album-covers/a/u/x-thumb.webp");
    expect(albumCoverPath(cover({ framing: { x: 50, y: 50, zoom: 2 } }), "card")).toBe("album-covers/a/u/x-display.webp");
    // Gallery thumbnails are smaller, so any zoom uses the display copy.
    expect(albumCoverPath(cover({ source: "photo", framing: { x: 50, y: 50, zoom: 1.2 } }), "card")).toBe("album-covers/a/u/x-display.webp");
    expect(albumCoverPath(cover({ source: "first_photo" }), "card")).toBe("album-covers/a/u/x-thumb.webp");
  });

  it("uses the large copy in the header and nothing stored for video stills", () => {
    expect(albumCoverPath(cover({}), "header")).toBe("album-covers/a/u/x-display.webp");
    const video = cover({ source: "video", thumb_path: null, display_path: null, video_asset_id: "v1" });
    expect(albumCoverPath(video, "card")).toBeNull();
    expect(albumVideoStill(video)).toBe("/api/media/v1/thumb");
    expect(albumVideoStill(cover({}))).toBeNull();
    expect(albumCoverPath(null, "card")).toBeNull();
  });

  it("treats only uploads and chosen photos as chosen covers", () => {
    expect(isChosenCover(cover({}))).toBe(true);
    expect(isChosenCover(cover({ source: "photo" }))).toBe(true);
    expect(isChosenCover(cover({ source: "first_photo" }))).toBe(false);
    expect(isChosenCover(cover({ source: "video" }))).toBe(false);
    expect(isChosenCover(null)).toBe(false);
  });
});
