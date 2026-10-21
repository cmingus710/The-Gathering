import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /auth/callback with a mocked Supabase client (no provider or Supabase is
 * contacted): error mapping, safe redirects, the name step, and no-store.
 */
const exchangeCodeForSession = vi.fn();
const profile = vi.fn();
const settle = vi.fn();

vi.mock("@/lib/membership/server", () => ({ settleOwnApprovalAlert: (...args: unknown[]) => settle(...args) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: profile }) }) }),
  }),
}));

const ORIGIN = "https://the-gathering-git-social-paint-by-number.vercel.app";

async function callback(query: string) {
  const { GET } = await import("@/app/auth/callback/route");
  const res = await GET(new NextRequest(`${ORIGIN}/auth/callback?${query}`));
  const location = res.headers.get("location");
  return { status: res.status, location: location ? new URL(location) : null, cache: res.headers.get("cache-control") };
}

describe("OAuth callback route", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    profile.mockReset();
    settle.mockReset();
    vi.stubEnv("VERCEL_ENV", "production");
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "u1" }, session: {} }, error: null });
    profile.mockResolvedValue({ data: { full_name: "Ruth Example", membership_status: "pending" } });
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends a successful sign-in to the requested page on the same origin", async () => {
    const r = await callback("code=abc&provider=google&next=%2Fprayer");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(r.status).toBe(303);
    expect(r.location?.origin).toBe(ORIGIN);
    expect(r.location?.pathname).toBe("/prayer");
    expect(r.cache).toBe("private, no-store");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/auth/callback"])("refuses next=%s", async (next) => {
    const r = await callback(`code=abc&provider=google&next=${encodeURIComponent(next)}`);
    expect(r.location?.origin).toBe(ORIGIN);
    expect(r.location?.pathname).toBe("/home");
  });

  it("asks for a name when the provider shared none (Apple)", async () => {
    profile.mockResolvedValue({ data: { full_name: "", membership_status: "pending" } });
    const r = await callback("code=abc&provider=apple");
    expect(r.location?.pathname).toBe("/complete-profile");
  });

  it("keeps the destination through the name step", async () => {
    profile.mockResolvedValue({ data: { full_name: " ", membership_status: "pending" } });
    const r = await callback("code=abc&provider=apple&next=%2Fevents");
    expect(r.location?.pathname).toBe("/complete-profile");
    expect(r.location?.searchParams.get("next")).toBe("/events");
  });

  it("doesn't ask a suspended account for anything", async () => {
    profile.mockResolvedValue({ data: { full_name: "", membership_status: "suspended" } });
    const r = await callback("code=abc&provider=apple");
    // /home re-checks status and sends suspended accounts to /account-status.
    expect(r.location?.pathname).toBe("/home");
  });

  it("explains a cancelled sign-in without exchanging anything", async () => {
    const r = await callback("error=access_denied&error_description=The+user+denied&provider=google");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(r.location?.pathname).toBe("/sign-in");
    expect(r.location?.searchParams.get("oauth_error")).toBe("cancelled");
    expect(r.location?.searchParams.get("provider")).toBe("google");
  });

  it("explains an expired or interrupted callback", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthApiError", code: "flow_state_not_found", message: "invalid flow state, no valid flow state found" },
    });
    const r = await callback("code=stale&provider=apple");
    expect(r.location?.searchParams.get("oauth_error")).toBe("expired");
  });

  it("treats a missing code as interrupted", async () => {
    const r = await callback("provider=google");
    expect(r.location?.searchParams.get("oauth_error")).toBe("expired");
  });

  it("returns linking results to the settings page", async () => {
    const ok = await callback("code=abc&intent=link&provider=apple");
    expect(ok.location?.pathname).toBe("/profile/sign-in-methods");
    expect(ok.location?.searchParams.get("linked")).toBe("apple");

    const conflict = await callback(
      "error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user&intent=link&provider=google",
    );
    expect(conflict.location?.pathname).toBe("/profile/sign-in-methods");
    expect(conflict.location?.searchParams.get("oauth_error")).toBe("conflict");
  });

  describe("membership approval alert", () => {
    it("releases a named pending account's alert in production", async () => {
      await callback("code=abc&provider=google");
      expect(settle).toHaveBeenCalledTimes(1);
    });
    it("waits for the name step in production when there's no name (Apple)", async () => {
      profile.mockResolvedValue({ data: { full_name: "", membership_status: "pending" } });
      await callback("code=abc&provider=apple");
      expect(settle).not.toHaveBeenCalled();
    });
    it("settles (as a test) right away on a preview, name or not", async () => {
      vi.stubEnv("VERCEL_ENV", "preview");
      profile.mockResolvedValue({ data: { full_name: "", membership_status: "pending" } });
      await callback("code=abc&provider=apple");
      expect(settle).toHaveBeenCalledTimes(1);
    });
    it("leaves approved and suspended accounts alone", async () => {
      for (const membership_status of ["approved", "suspended"]) {
        profile.mockResolvedValue({ data: { full_name: "Ruth", membership_status } });
        await callback("code=abc&provider=google");
      }
      expect(settle).not.toHaveBeenCalled();
    });
  });

  it("ignores an unknown provider value", async () => {
    const r = await callback("error=access_denied&provider=%3Cscript%3E");
    expect(r.location?.searchParams.get("provider")).toBeNull();
  });
});
