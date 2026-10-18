import { describe, expect, it } from "vitest";
import { parseAnnouncementForm, type AnnouncementInput } from "./schema";

const now = new Date("2026-10-18T15:00:00Z"); // 10:00 CDT
const tz = "America/Chicago";
const input = (over: Partial<AnnouncementInput> = {}): AnnouncementInput => ({
  title: "Fall gathering",
  body: "Join us",
  visibility: "members",
  pinned: false,
  publishAt: "",
  expiresAt: "",
  imageAlt: "",
  intent: "save_draft",
  ...over,
});

describe("parseAnnouncementForm", () => {
  it("saves a draft with no dates", () => {
    const r = parseAnnouncementForm(input(), { timeZone: tz, now, hasImage: false });
    expect(r.ok && r.data).toMatchObject({ status: "draft", publish_at: null, expires_at: null });
  });

  it("publishes now at the current instant", () => {
    const r = parseAnnouncementForm(input({ intent: "publish_now", expiresAt: "2026-10-25T10:00" }), { timeZone: tz, now, hasImage: false });
    expect(r.ok && r.data).toMatchObject({
      status: "published",
      publish_at: "2026-10-18T15:00:00.000Z",
      expires_at: "2026-10-25T15:00:00.000Z",
    });
  });

  it("schedules using church time", () => {
    const r = parseAnnouncementForm(input({ intent: "schedule", publishAt: "2026-10-19T08:00" }), { timeZone: tz, now, hasImage: false });
    expect(r.ok && r.data).toMatchObject({ status: "scheduled", publish_at: "2026-10-19T13:00:00.000Z" });
  });

  it("rejects scheduling in the past or without a time", () => {
    for (const publishAt of ["", "2026-10-18T09:00"]) {
      const r = parseAnnouncementForm(input({ intent: "schedule", publishAt }), { timeZone: tz, now, hasImage: false });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects an expiration before publishing", () => {
    const r = parseAnnouncementForm(
      input({ intent: "schedule", publishAt: "2026-10-20T08:00", expiresAt: "2026-10-19T08:00" }),
      { timeZone: tz, now, hasImage: false },
    );
    expect(r.ok).toBe(false);
  });

  it("requires alt text when an image is attached", () => {
    const r = parseAnnouncementForm(input(), { timeZone: tz, now, hasImage: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.issues[0].path).toEqual(["imageAlt"]);
  });

  it("requires a title", () => {
    expect(parseAnnouncementForm(input({ title: "   " }), { timeZone: tz, now, hasImage: false }).ok).toBe(false);
  });
});
