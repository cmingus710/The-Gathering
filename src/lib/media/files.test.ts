import { describe, expect, it } from "vitest";
import { declaredMime, formatBytes, sanitizeVtt, sniffAsset, vttToTranscript } from "./files";

const ftyp = (major: string, ...compat: string[]) => {
  const size = 16 + compat.length * 4;
  const b = Buffer.alloc(size);
  b.writeUInt32BE(size, 0);
  b.write("ftyp", 4, "latin1");
  b.write(major, 8, "latin1");
  compat.forEach((c, i) => b.write(c, 16 + i * 4, "latin1"));
  return new Uint8Array(b);
};

describe("file signatures", () => {
  it("recognizes supported audio and video", () => {
    expect(sniffAsset("audio", new Uint8Array(Buffer.from("ID3\u0004\u0000")))).toMatchObject({ ok: true, mime: "audio/mpeg" });
    expect(sniffAsset("audio", new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toMatchObject({ ok: true, mime: "audio/mpeg" });
    expect(sniffAsset("audio", ftyp("M4A ", "M4A ", "isom"))).toMatchObject({ ok: true, mime: "audio/mp4" });
    expect(sniffAsset("audio", new Uint8Array([0xff, 0xf1, 0x50, 0x80]))).toMatchObject({ ok: true, mime: "audio/aac" });
    expect(sniffAsset("video", ftyp("isom", "isom", "avc1", "mp41"))).toMatchObject({ ok: true, mime: "video/mp4" });
  });

  it("refuses QuickTime, images posing as video, and unknown bytes with useful messages", () => {
    expect(sniffAsset("video", ftyp("qt  "))).toMatchObject({ ok: false, message: expect.stringMatching(/Export as MP4/) });
    expect(sniffAsset("video", ftyp("heic", "mif1"))).toMatchObject({ ok: false });
    expect(sniffAsset("audio", new Uint8Array(Buffer.from("<html>")))).toMatchObject({ ok: false });
    expect(sniffAsset("audio", new Uint8Array(Buffer.from("RIFF....WAVE")))).toMatchObject({ ok: false });
  });

  it("accepts PDF and PowerPoint only, without macros", () => {
    expect(sniffAsset("document", new Uint8Array(Buffer.from("%PDF-1.7\n")))).toMatchObject({ ok: true, mime: "application/pdf" });
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const pptxTail = new Uint8Array(Buffer.from("[Content_Types].xml ppt/presentation.xml ppt/slides/slide1.xml"));
    expect(sniffAsset("document", zip, pptxTail)).toMatchObject({ ok: true, mime: expect.stringContaining("presentationml") });
    expect(sniffAsset("document", zip, new Uint8Array(Buffer.from("[Content_Types].xml word/document.xml")))).toMatchObject({ ok: false });
    expect(sniffAsset("document", zip, new Uint8Array(Buffer.from("[Content_Types].xml ppt/presentation.xml ppt/vbaProject.bin")))).toMatchObject({ ok: false });
    expect(sniffAsset("document", new Uint8Array(Buffer.from("<svg onload=alert(1)>")))).toMatchObject({ ok: false });
  });

  it("accepts WebVTT and removes markup beyond cue tags", () => {
    expect(sniffAsset("captions", new Uint8Array(Buffer.from("﻿WEBVTT\n\n00:00.000 --> 00:01.000\nHi")))).toMatchObject({ ok: true });
    expect(sniffAsset("captions", new Uint8Array(Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nSRT")))).toMatchObject({ ok: false });
    const vtt = "WEBVTT\n\n00:00.000 --> 00:02.000\n<v Speaker>Hello <b>there</b><script>x</script><img src=x>\n\n00:02.000 --> 00:04.000\nAgain";
    expect(sanitizeVtt(vtt)).not.toMatch(/<script|<img/);
    expect(sanitizeVtt(vtt)).toContain("<b>there</b>");
    expect(vttToTranscript(vtt)).toBe("Hello therex\nAgain");
  });

  it("formats sizes and infers MIME types from extensions", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(52_428_800)).toBe("50 MB");
    expect(declaredMime("audio", "talk.m4a", "audio/x-m4a")).toBe("audio/mp4");
    expect(declaredMime("image", "IMG_0001.HEIC", "")).toBe("image/heic");
    expect(declaredMime("document", "slides.pptx", "application/octet-stream")).toContain("presentationml");
  });
});
