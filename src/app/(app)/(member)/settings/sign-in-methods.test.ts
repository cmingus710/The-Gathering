import { describe, expect, it } from "vitest";
import { signInMethods } from "./sign-in-methods";

describe("signInMethods", () => {
  it("labels known providers once each", () => {
    expect(
      signInMethods({ identities: [{ provider: "email" }, { provider: "google" }] as never, app_metadata: { providers: ["email", "google"] } }),
    ).toEqual(["Email and password", "Google"]);
  });
  it("falls back to email and password when nothing is linked", () => {
    expect(signInMethods(null)).toEqual(["Email and password"]);
  });
  it("shows unknown providers by name", () => {
    expect(signInMethods({ identities: [], app_metadata: { providers: ["github"] } })).toEqual(["Github"]);
  });
});
