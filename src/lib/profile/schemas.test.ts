import { describe, expect, it } from "vitest";
import { adminProfileSchema, interestLabelSchema, memberProfileSchema, parsePrivacy, PRIVACY_KEYS } from "./schemas";

const base = {
  firstName: "Alice",
  lastName: "",
  preferredName: "",
  phone: "",
  contactEmail: "",
  streetAddress: "",
  city: "",
  stateRegion: "",
  postalCode: "",
  bio: "",
  birthdayMonth: "",
  birthdayDay: "",
  interests: [],
};

describe("member profile validation", () => {
  it("needs only a first name; everything else becomes null when blank", () => {
    const r = memberProfileSchema.parse(base);
    expect(r).toMatchObject({ firstName: "Alice", lastName: null, phone: null, contactEmail: null, birthdayMonth: null, birthdayDay: null });
    expect(memberProfileSchema.safeParse({ ...base, firstName: "  " }).success).toBe(false);
  });

  it("validates the directory email separately and lower-cases it", () => {
    expect(memberProfileSchema.parse({ ...base, contactEmail: " Alice@Example.TEST " }).contactEmail).toBe("alice@example.test");
    const bad = memberProfileSchema.safeParse({ ...base, contactEmail: "nope" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].path).toEqual(["contactEmail"]);
  });

  it("accepts month/day birthdays and rejects impossible or half-filled ones", () => {
    expect(memberProfileSchema.parse({ ...base, birthdayMonth: "2", birthdayDay: "29" })).toMatchObject({ birthdayMonth: 2, birthdayDay: 29 });
    for (const [m, d] of [["2", "30"], ["4", "31"], ["13", "1"], ["5", ""], ["", "5"]]) {
      expect(memberProfileSchema.safeParse({ ...base, birthdayMonth: m, birthdayDay: d }).success).toBe(false);
    }
  });

  it("limits field lengths and phone characters", () => {
    expect(memberProfileSchema.safeParse({ ...base, bio: "x".repeat(501) }).success).toBe(false);
    expect(memberProfileSchema.safeParse({ ...base, phone: "call me maybe" }).success).toBe(false);
    expect(memberProfileSchema.safeParse({ ...base, phone: "+1 (555) 010-0100" }).success).toBe(true);
  });

  it("accepts only interest ids", () => {
    expect(memberProfileSchema.safeParse({ ...base, interests: ["not-a-uuid"] }).success).toBe(false);
    expect(memberProfileSchema.safeParse({ ...base, interests: ["5b1f8f3e-2c4e-4d0a-9a51-3f5f1c2b7a10"] }).success).toBe(true);
  });

  it("requires a valid target for admin corrections and never accepts privacy fields", () => {
    const { interests: _i, ...rest } = base;
    void _i;
    expect(adminProfileSchema.safeParse({ ...rest, userId: "x", removePhoto: false }).success).toBe(false);
    const ok = adminProfileSchema.parse({ ...rest, userId: "5b1f8f3e-2c4e-4d0a-9a51-3f5f1c2b7a10", removePhoto: true, show_phone: true });
    expect(ok).not.toHaveProperty("show_phone");
  });
});

describe("privacy form parsing", () => {
  it("treats absent checkboxes as hidden and ignores unknown keys", () => {
    const fd = new FormData();
    fd.set("directory_listed", "on");
    fd.set("show_phone", "on");
    fd.set("membership_status", "approved");
    const p = parsePrivacy(fd);
    expect(Object.keys(p).sort()).toEqual([...PRIVACY_KEYS].sort());
    expect(p).toMatchObject({ directory_listed: true, show_phone: true, show_birthday: false, show_photo: false });
  });
});

describe("ministry interest labels", () => {
  it("trims names and bounds the order", () => {
    expect(interestLabelSchema.parse({ label: "  Music ", sortOrder: "" })).toEqual({ label: "Music", sortOrder: 0 });
    expect(interestLabelSchema.safeParse({ label: "", sortOrder: "1" }).success).toBe(false);
    expect(interestLabelSchema.safeParse({ label: "X", sortOrder: "1.5" }).success).toBe(false);
  });
});
