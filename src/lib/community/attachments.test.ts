import { describe, expect, it } from "vitest";
import { ATTACHMENT_LIMITS, VIDEO_FORMAT_MESSAGE, attachmentUrl, checkForumVideo, classifyAttachment, formatDuration, sampleEntryTypes } from "./attachments";

const MB = 1024 * 1024;

/** A minimal MP4 head: ftyp box, then (optionally) a moov fragment with one stsd entry per codec. */
function mp4(major: string, codecs: string[] = [], compat: string[] = ["isom"]) {
  const ftypSize = 16 + compat.length * 4;
  const parts: Buffer[] = [];
  const ftyp = Buffer.alloc(ftypSize);
  ftyp.writeUInt32BE(ftypSize, 0);
  ftyp.write("ftyp", 4, "latin1");
  ftyp.write(major, 8, "latin1");
  compat.forEach((c, i) => ftyp.write(c, 16 + i * 4, "latin1"));
  parts.push(ftyp);
  for (const codec of codecs) {
    const stsd = Buffer.alloc(32);
    stsd.writeUInt32BE(32, 0);
    stsd.write("stsd", 4, "latin1");
    stsd.writeUInt32BE(1, 12); // entry count
    stsd.writeUInt32BE(16, 16); // entry size
    stsd.write(codec, 20, "latin1");
    parts.push(stsd);
  }
  return new Uint8Array(Buffer.concat(parts));
}

describe("classifyAttachment", () => {
  it("accepts photos (HEIC included) and MP4 video within the limits", () => {
    expect(classifyAttachment("a.jpg", "image/jpeg", 1000)).toEqual({ ok: true, kind: "image", mime: "image/jpeg" });
    expect(classifyAttachment("IMG_0001.HEIC", "", 1000)).toEqual({ ok: true, kind: "image", mime: "image/heic" });
    expect(classifyAttachment("b.heif", "image/heif", 1000)).toMatchObject({ ok: true, kind: "image" });
    expect(classifyAttachment("c.webp", "application/octet-stream", 1000)).toMatchObject({ ok: true, kind: "image", mime: "image/webp" });
    expect(classifyAttachment("clip.mp4", "video/mp4", 10 * MB)).toEqual({ ok: true, kind: "video", mime: "video/mp4" });
    expect(classifyAttachment("clip.mp4", "", 10 * MB)).toMatchObject({ ok: true, kind: "video" });
  });

  it("refuses QuickTime and other video formats with export advice", () => {
    expect(classifyAttachment("IMG_0002.MOV", "video/quicktime", 1000)).toEqual({ ok: false, message: VIDEO_FORMAT_MESSAGE });
    expect(classifyAttachment("x.webm", "video/webm", 1000)).toEqual({ ok: false, message: VIDEO_FORMAT_MESSAGE });
    expect(classifyAttachment("x.mov", "", 1000)).toEqual({ ok: false, message: VIDEO_FORMAT_MESSAGE });
    expect(VIDEO_FORMAT_MESSAGE).toMatch(/^This video format can't be played on every device; export as MP4 \(H\.264\)/);
  });

  it("refuses other files and enforces sizes", () => {
    expect(classifyAttachment("doc.pdf", "application/pdf", 1000)).toMatchObject({ ok: false });
    expect(classifyAttachment("anim.gif", "image/gif", 1000)).toMatchObject({ ok: false });
    expect(classifyAttachment("a.jpg", "image/jpeg", 0)).toMatchObject({ ok: false });
    expect(classifyAttachment("a.jpg", "image/jpeg", ATTACHMENT_LIMITS.imageMb * MB + 1)).toEqual({ ok: false, message: "Photos must be 20 MB or smaller." });
    expect(classifyAttachment("a.mp4", "video/mp4", ATTACHMENT_LIMITS.videoMb * MB + 1)).toEqual({ ok: false, message: "Videos must be 50 MB or smaller." });
    expect(classifyAttachment("a.mp4", "video/mp4", ATTACHMENT_LIMITS.videoMb * MB)).toMatchObject({ ok: true });
  });
});

describe("checkForumVideo", () => {
  it("accepts H.264 MP4 whether the codec is described at the start or the end", () => {
    expect(checkForumVideo(mp4("isom", ["avc1", "mp4a"]))).toEqual({ ok: true });
    expect(checkForumVideo(mp4("mp42"), mp4("mp42", ["mp4a", "avc1"]).subarray(20))).toEqual({ ok: true });
  });

  it("refuses HEVC, QuickTime, AV1/VP9, images, and unknown bytes", () => {
    expect(checkForumVideo(mp4("isom", ["hvc1", "mp4a"]))).toEqual({ ok: false, message: VIDEO_FORMAT_MESSAGE });
    expect(checkForumVideo(mp4("mp42", ["hev1"]))).toEqual({ ok: false, message: VIDEO_FORMAT_MESSAGE });
    expect(checkForumVideo(mp4("qt  ", ["avc1"]))).toEqual({ ok: false, message: VIDEO_FORMAT_MESSAGE });
    expect(checkForumVideo(mp4("isom", ["av01"]))).toEqual({ ok: false, message: VIDEO_FORMAT_MESSAGE });
    // An HEVC track wins even if an H.264 track is also present.
    expect(checkForumVideo(mp4("isom", ["avc1", "hvc1"]))).toMatchObject({ ok: false });
    expect(checkForumVideo(mp4("heic", [], ["mif1"]))).toMatchObject({ ok: false, message: expect.stringMatching(/photo/) });
    expect(checkForumVideo(new Uint8Array(Buffer.from("<html>not a video</html>")))).toMatchObject({ ok: false, message: expect.stringMatching(/isn't an MP4/) });
    // An "avc1" compatible brand in ftyp alone doesn't prove the codec.
    expect(checkForumVideo(mp4("isom", [], ["isom", "avc1"]))).toMatchObject({ ok: false, message: expect.stringMatching(/couldn't confirm/) });
  });

  it("reads sample entry types from stsd boxes only", () => {
    expect(sampleEntryTypes(mp4("isom", ["avc1", "mp4a"]))).toEqual(["avc1", "mp4a"]);
    expect(sampleEntryTypes(new Uint8Array(64))).toEqual([]);
  });
});

describe("helpers", () => {
  it("builds the authorized serving URL and formats durations", () => {
    expect(attachmentUrl("0b9e0a8e-1111-4222-8333-944455556666", "thumb")).toBe("/api/community/attachments/0b9e0a8e-1111-4222-8333-944455556666?variant=thumb");
    expect(formatDuration(65.4)).toBe("1:05");
    expect(formatDuration(null)).toBeNull();
  });
});
