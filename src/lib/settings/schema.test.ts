import { describe, expect, it } from "vitest";
import { readGatheringRows, settingsSchema } from "./schema";

const valid = {
  churchName: "The Gathering",
  description: "",
  contactEmail: "",
  contactPhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  timezone: "America/Chicago",
  gatheringTimes: [],
  socialLinks: { website: "", facebook: "", instagram: "", youtube: "" },
};

describe("settings schema", () => {
  it("accepts an unconfigured church and stores empty fields as null", () => {
    const r = settingsSchema.parse(valid);
    expect(r.contactEmail).toBeNull();
    expect(r.description).toBeNull();
  });

  it("validates email, phone, time zone, and links", () => {
    const r = settingsSchema.safeParse({
      ...valid,
      contactEmail: "not-an-email",
      contactPhone: "call me",
      timezone: "Nowhere/Here",
      socialLinks: { ...valid.socialLinks, website: "javascript:alert(1)" },
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["contactEmail", "contactPhone", "timezone", "socialLinks.website"]));
  });

  it("validates gathering times", () => {
    const ok = settingsSchema.safeParse({ ...valid, gatheringTimes: [{ label: "Worship", day: "sunday", time: "10:30", location: "" }] });
    expect(ok.success && ok.data.gatheringTimes[0]).toEqual({ label: "Worship", day: "sunday", time: "10:30", location: null });
    const bad = settingsSchema.safeParse({ ...valid, gatheringTimes: [{ label: "", day: "someday", time: "25:00", location: "" }] });
    expect(bad.success).toBe(false);
  });

  it("reads repeated gathering rows from form data and skips blank rows", () => {
    const fd = new FormData();
    fd.set("gathering[1][label]", "Prayer");
    fd.set("gathering[1][day]", "wednesday");
    fd.set("gathering[0][label]", "Worship");
    fd.set("gathering[0][day]", "sunday");
    fd.set("gathering[2][label]", "");
    expect(readGatheringRows(fd)).toEqual([
      { label: "Worship", day: "sunday" },
      { label: "Prayer", day: "wednesday" },
    ]);
  });
});
