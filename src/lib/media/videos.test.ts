import { describe, expect, it } from "vitest";
import { storedVideoRef, videoEmbed } from "./embeds";
import type { Attachment, VideoPublishing } from "./types";
import { oembedUrl, statusFromHttp, vimeoThumbUrl, youtubeThumbCandidates } from "./video-provider";
import { attachmentVideo, videoAttachments, videoCaption } from "./videos";
import { itemReasons, videoAssetReasons } from "./visibility";

const when = (iso: string) => iso.slice(0, 10);
const att = (over: Partial<Attachment>): Attachment => ({
  asset_id: "a1",
  role: "video",
  label: "Video",
  title: "Video",
  kind: "external_video",
  mime: null,
  size_bytes: null,
  duration_seconds: null,
  width: null,
  height: null,
  members_only: false,
  public_ok: false,
  status: "ready",
  provider: "youtube",
  provider_ref: "dQw4w9WgXcQ",
  provider_hash: null,
  external_url: null,
  path: null,
  has_transcript: false,
  rights_confirmed: false,
  attribution: null,
  captions: [],
  ...over,
});
const none: VideoPublishing = { standalone: [], attached: [], albums: [], blocks: 0 };

describe("stored video references", () => {
  it("rebuilds embeds only from valid identifiers", () => {
    expect(storedVideoRef({ provider: "youtube", provider_ref: "dQw4w9WgXcQ" })).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    expect(storedVideoRef({ provider: "youtube", provider_ref: "<script>" })).toBeNull();
    expect(storedVideoRef({ provider: "vimeo", provider_ref: "76979871", provider_hash: "abc123def" })).toEqual({ provider: "vimeo", id: "76979871", hash: "abc123def" });
    expect(storedVideoRef({ provider: "vimeo", provider_ref: "76979871", provider_hash: "bad hash!" })).toEqual({ provider: "vimeo", id: "76979871", hash: null });
    expect(storedVideoRef({ provider: "other", provider_ref: "x" })).toBeNull();
  });

  it("starts playback from the press of Play, never on load", () => {
    const e = videoEmbed({ provider: "youtube", id: "dQw4w9WgXcQ" }, { origin: "https://example.test", autoplay: true });
    expect(e.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(new URL(e.src).searchParams.get("autoplay")).toBe("1");
    expect(new URL(e.src).searchParams.get("playsinline")).toBe("1");
    expect(e.allow).toContain("autoplay");
    expect(e.openUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});

describe("provider checks", () => {
  it("contacts fixed provider hosts only", () => {
    expect(youtubeThumbCandidates("dQw4w9WgXcQ")[1]).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(new URL(oembedUrl({ provider: "youtube", id: "dQw4w9WgXcQ" })).host).toBe("www.youtube.com");
    expect(new URL(oembedUrl({ provider: "vimeo", id: "76979871", hash: null })).host).toBe("vimeo.com");
    expect(vimeoThumbUrl("https://i.vimeocdn.com/video/1.jpg")).toBe("https://i.vimeocdn.com/video/1.jpg");
    expect(vimeoThumbUrl("https://evil.example/video/1.jpg")).toBeNull();
    expect(vimeoThumbUrl("http://i.vimeocdn.com/video/1.jpg")).toBeNull();
  });

  it("maps oEmbed answers without guessing", () => {
    expect(statusFromHttp(200)).toBe("ok");
    expect(statusFromHttp(401)).toBe("not_embeddable");
    expect(statusFromHttp(403)).toBe("not_embeddable");
    expect(statusFromHttp(404)).toBe("unavailable");
    expect(statusFromHttp(500)).toBe("error");
  });
});

describe("attachments as videos", () => {
  it("keeps the administrator's order and captions", () => {
    const list = [att({ asset_id: "a1", caption: "First" }), att({ asset_id: "d1", role: "handout", kind: "document" }), att({ asset_id: "a2", caption: null })];
    expect(videoAttachments(list).map((a) => a.asset_id)).toEqual(["a1", "a2"]);
    expect(videoCaption(list[0])).toBe("First");
    expect(videoCaption(att({ caption: "Video", title: "Video" }))).toBeNull();
    expect(attachmentVideo(att({ unavailable: true })).unavailable).toBe(true);
    expect(attachmentVideo(att({ provider: "vimeo", has_thumb: undefined })).has_thumb).toBe(false);
  });
});

describe("visibility reasons", () => {
  it("says a library-only video isn't visible", () => {
    const r = videoAssetReasons({ status: "ready", provider: "youtube", provider_status: null, publishing: none }, when);
    expect(r.map((x) => x.title)).toEqual(["Library file only: members can't find it"]);
  });

  it("explains drafts, schedules, groups, attachments, and provider problems", () => {
    const r = videoAssetReasons(
      {
        status: "ready",
        provider: "youtube",
        provider_status: "not_embeddable",
        publishing: {
          standalone: [{ id: "i", title: "T", state: "scheduled", audience: "group", group_name: "Choir", publish_at: "2026-11-01T10:00:00Z", expires_at: null }],
          attached: [{ id: "l", kind: "lesson", title: "L", state: "draft", audience: "members", group_name: null, role: "video", members_only: false }],
          albums: [],
          blocks: 0,
        },
      },
      when,
    );
    const titles = r.map((x) => x.title);
    expect(titles[0]).toMatch(/won't play this video inside other sites/);
    expect(titles).toContain("Video page: Scheduled: goes live 2026-11-01");
    expect(r.find((x) => x.title.startsWith("Video page"))?.detail).toMatch(/Only Choir can see it/);
    expect(titles).toContain("Attached to 1 page that isn't published");
  });

  it("covers content items", () => {
    const draft = itemReasons({ kind: "video", state: "draft", audience: "members", group_name: null, publish_at: null, expires_at: null, attachments: [] }, when);
    expect(draft.map((x) => x.title)).toEqual(["Draft (not published)", "No video chosen", "Listed in Videos and search when published"]);
    const lesson = itemReasons({ kind: "lesson", state: "live", audience: "group", group_name: "Youth", publish_at: "2026-10-01T00:00:00Z", expires_at: null, attachments: [att({})] }, when);
    expect(lesson.map((x) => x.title)).toEqual(["Published 2026-10-01", "Restricted: Group: Youth", "Its videos play inside this page"]);
  });
});
