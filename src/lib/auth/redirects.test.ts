import { describe, expect, it } from "vitest";
import { getSiteUrl } from "@/lib/site-url";
import { authErrorMessage } from "./errors";
import { safeNextPath } from "./redirects";

describe("safeNextPath", () => {
  it.each([
    ["/announcements", "/announcements"],
    ["/admin/members?status=pending", "/admin/members?status=pending"],
  ])("keeps %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", "home", "/auth/confirm", null, 42])(
    "rejects %s",
    (input) => expect(safeNextPath(input)).toBe("/home"),
  );
});

describe("getSiteUrl", () => {
  it("prefers the explicit site URL", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://app.example.org/", VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app" })).toBe(
      "https://app.example.org",
    );
  });
  it("uses the branch URL on Vercel previews", () => {
    expect(getSiteUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "gathering-git-phase-1.vercel.app", VERCEL_URL: "x.vercel.app" })).toBe(
      "https://gathering-git-phase-1.vercel.app",
    );
  });
  it("falls back to localhost", () => {
    expect(getSiteUrl({})).toBe("http://localhost:3000");
  });
});

describe("authErrorMessage", () => {
  it("never echoes raw provider messages", () => {
    expect(authErrorMessage({ message: "pq: relation secret_table does not exist", status: 400 })).toBe(
      "Something went wrong. Please try again.",
    );
  });
  it("maps common cases", () => {
    expect(authErrorMessage({ code: "invalid_credentials" })).toMatch(/don't match/);
    expect(authErrorMessage({ code: "email_not_confirmed" })).toMatch(/verify your email/);
    expect(authErrorMessage({ status: 429 })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toMatch(/couldn't reach/);
  });
});
