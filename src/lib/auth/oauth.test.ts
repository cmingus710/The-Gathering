import { describe, expect, it } from "vitest";
import {
  canUnlink,
  classifyOAuthError,
  identityLinkingEnabled,
  isApplePrivateRelay,
  isOAuthErrorKind,
  oauthCallbackUrl,
  oauthErrorCopy,
  providerSuggestedName,
  providersFromEnv,
  resolveAuthOrigin,
} from "./oauth";

const PREVIEW = {
  VERCEL_ENV: "preview",
  VERCEL_BRANCH_URL: "the-gathering-git-claude-social-paint-by-number.vercel.app",
  VERCEL_URL: "the-gathering-abc123-paint-by-number.vercel.app",
};
const PRODUCTION = {
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://www.gathering.church",
  VERCEL_PROJECT_PRODUCTION_URL: "gathering.church",
  VERCEL_URL: "the-gathering-xyz-paint-by-number.vercel.app",
};

describe("resolveAuthOrigin", () => {
  it("keeps a preview on its own branch URL", () => {
    expect(resolveAuthOrigin("https://the-gathering-git-claude-social-paint-by-number.vercel.app", PREVIEW)).toBe(
      "https://the-gathering-git-claude-social-paint-by-number.vercel.app",
    );
  });
  it("keeps a preview on its deployment URL (the PKCE cookie lives there)", () => {
    expect(resolveAuthOrigin("https://the-gathering-abc123-paint-by-number.vercel.app", PREVIEW)).toBe(
      "https://the-gathering-abc123-paint-by-number.vercel.app",
    );
  });
  it("never sends a preview to production", () => {
    expect(resolveAuthOrigin("https://www.gathering.church", PREVIEW)).toBe(
      "https://the-gathering-git-claude-social-paint-by-number.vercel.app",
    );
  });
  it("uses the production site URL in production", () => {
    expect(resolveAuthOrigin("https://www.gathering.church", PRODUCTION)).toBe("https://www.gathering.church");
    expect(resolveAuthOrigin("https://gathering.church", PRODUCTION)).toBe("https://gathering.church");
  });
  it("does not trust production's per-deployment URL unless listed", () => {
    expect(resolveAuthOrigin("https://the-gathering-xyz-paint-by-number.vercel.app", PRODUCTION)).toBe("https://www.gathering.church");
    expect(
      resolveAuthOrigin("https://the-gathering-five.vercel.app", { ...PRODUCTION, AUTH_ALLOWED_ORIGINS: "https://the-gathering-five.vercel.app" }),
    ).toBe("https://the-gathering-five.vercel.app");
  });
  it.each([
    "https://evil.example",
    "https://www.gathering.church.evil.example",
    "javascript:alert(1)",
    "null",
    "",
    null,
    undefined,
  ])("ignores a forged or missing origin %s", (origin) => {
    expect(resolveAuthOrigin(origin, PRODUCTION)).toBe("https://www.gathering.church");
    expect(resolveAuthOrigin(origin, PREVIEW)).toBe("https://the-gathering-git-claude-social-paint-by-number.vercel.app");
  });
  it("allows any localhost port only off Vercel", () => {
    expect(resolveAuthOrigin("http://localhost:3100", {})).toBe("http://localhost:3100");
    expect(resolveAuthOrigin("http://localhost:3100", PREVIEW)).toBe(
      "https://the-gathering-git-claude-social-paint-by-number.vercel.app",
    );
  });
});

describe("oauthCallbackUrl", () => {
  it("builds the Supabase-to-app redirect URL", () => {
    expect(oauthCallbackUrl("https://www.gathering.church", "sign-in", "/home", "google")).toBe(
      "https://www.gathering.church/auth/callback?provider=google",
    );
    expect(oauthCallbackUrl("https://www.gathering.church", "sign-in", "/prayer?tab=mine", "apple")).toBe(
      "https://www.gathering.church/auth/callback?provider=apple&next=%2Fprayer%3Ftab%3Dmine",
    );
    expect(oauthCallbackUrl("http://localhost:3100", "link", "/home", "apple")).toBe(
      "http://localhost:3100/auth/callback?intent=link&provider=apple",
    );
  });
});

describe("providersFromEnv and linking flag", () => {
  it("only lists known providers the operator switched on", () => {
    expect(providersFromEnv({})).toEqual([]);
    expect(providersFromEnv({ AUTH_OAUTH_PROVIDERS: "apple" })).toEqual(["apple"]);
    expect(providersFromEnv({ AUTH_OAUTH_PROVIDERS: " Apple, google ,github" })).toEqual(["google", "apple"]);
  });
  it("is off unless explicitly on", () => {
    expect(identityLinkingEnabled({})).toBe(false);
    expect(identityLinkingEnabled({ AUTH_IDENTITY_LINKING: "off" })).toBe(false);
    expect(identityLinkingEnabled({ AUTH_IDENTITY_LINKING: "on" })).toBe(true);
  });
});

describe("classifyOAuthError", () => {
  it.each([
    [{ error: "access_denied", description: "The user denied the request" }, "cancelled"],
    [{ error: "user_cancelled_authorize" }, "cancelled"],
    [{ error: "server_error", code: "identity_already_exists", description: "Identity is already linked to another user" }, "conflict"],
    [{ code: "manual_linking_disabled" }, "linking_disabled"],
    [{ code: "provider_email_needs_verification" }, "verify_email"],
    [{ error: "access_denied", code: "signup_disabled", description: "Signups not allowed for this instance" }, "signup_disabled"],
    [{ code: "flow_state_expired" }, "expired"],
    [{ code: "flow_state_not_found" }, "expired"],
    [{ code: "bad_code_verifier" }, "expired"],
    [{ name: "AuthPKCECodeVerifierMissingError", description: "PKCE code verifier not found in storage." }, "expired"],
    [{ error: "server_error", description: "Unable to exchange external code: 4/0Adeu…" }, "failed"],
    [{}, "failed"],
  ] as const)("%o → %s", (input, kind) => expect(classifyOAuthError(input)).toBe(kind));

  it("only accepts known kinds from the query string", () => {
    expect(isOAuthErrorKind("conflict")).toBe(true);
    expect(isOAuthErrorKind("toString")).toBe(false);
    expect(isOAuthErrorKind("<script>")).toBe(false);
  });

  it("names the provider and never echoes raw text", () => {
    expect(oauthErrorCopy("conflict", "apple").title).toBe("That Apple account is already connected to a different account here");
    expect(oauthErrorCopy("failed", "<b>evil</b>").title).toBe("We couldn't complete sign-in with that service");
  });
});

describe("Apple private relay and names", () => {
  it("recognizes relay addresses", () => {
    expect(isApplePrivateRelay("x7k2q9@privaterelay.appleid.com")).toBe(true);
    expect(isApplePrivateRelay("X7K2Q9@PrivateRelay.AppleID.com ")).toBe(true);
    expect(isApplePrivateRelay("someone@icloud.com")).toBe(false);
    expect(isApplePrivateRelay("privaterelay.appleid.com@evil.example")).toBe(false);
    expect(isApplePrivateRelay(null)).toBe(false);
  });
  it("takes a provider name when there is one (Google) and nothing otherwise (Apple)", () => {
    expect(providerSuggestedName({ full_name: "  Ruth Example ", name: "Ruth" })).toBe("Ruth Example");
    expect(providerSuggestedName({ name: "Boaz Example" })).toBe("Boaz Example");
    expect(providerSuggestedName({ email: "x@privaterelay.appleid.com", sub: "000123.abc" })).toBe("");
    expect(providerSuggestedName(null)).toBe("");
  });
});

describe("canUnlink", () => {
  const email = { provider: "email", identityId: "e", email: "m@example.test" };
  const google = { provider: "google", identityId: "g", email: "m@gmail.example" };
  const apple = { provider: "apple", identityId: "a", email: "r@privaterelay.appleid.com" };

  it("allows removing a provider when the password remains", () => {
    expect(canUnlink([email, google], "google", ["google", "apple"])).toBe(true);
  });
  it("allows removing one provider when another offered provider remains", () => {
    expect(canUnlink([google, apple], "google", ["google", "apple"])).toBe(true);
  });
  it("refuses when the only remaining provider is no longer offered", () => {
    expect(canUnlink([google, apple], "google", ["google"])).toBe(false);
  });
  it("refuses the last sign-in method", () => {
    expect(canUnlink([google], "google", ["google", "apple"])).toBe(false);
  });
  it("refuses a provider that isn't linked", () => {
    expect(canUnlink([email], "apple", ["google", "apple"])).toBe(false);
  });
});
