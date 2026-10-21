import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A provider button appears only when switched on here AND enabled in Supabase (mocked settings). */
describe("getOfferedProviders", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const settings = (external: Record<string, boolean>) =>
    vi.fn(async () => new Response(JSON.stringify({ external }), { status: 200 }));
  const offered = async () => (await import("@/lib/auth/oauth-config")).getOfferedProviders();

  it("shows nothing until the deployment switches providers on", async () => {
    const fetch = settings({ google: true, apple: true });
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("AUTH_OAUTH_PROVIDERS", "");
    expect(await offered()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("hides a provider Supabase hasn't enabled", async () => {
    vi.stubGlobal("fetch", settings({ google: true, apple: false }));
    vi.stubEnv("AUTH_OAUTH_PROVIDERS", "google,apple");
    expect(await offered()).toEqual(["google"]);
  });

  it("asks Supabase's public settings endpoint with the publishable key only", async () => {
    const fetch = settings({ google: true, apple: true });
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("AUTH_OAUTH_PROVIDERS", "apple,google");
    expect(await offered()).toEqual(["google", "apple"]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.invalid/auth/v1/settings");
    expect(init.headers).toEqual({ apikey: "sb_publishable_test" });
  });

  it("shows nothing when Supabase can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    vi.stubEnv("AUTH_OAUTH_PROVIDERS", "google,apple");
    expect(await offered()).toEqual([]);
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await offered()).toEqual([]);
  });
});
