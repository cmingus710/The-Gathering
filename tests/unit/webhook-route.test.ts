import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The webhook rejects unsigned and mis-signed requests before any processing. */
describe("Stripe webhook route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_" + "a".repeat(24));
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_" + "b".repeat(32));
    vi.stubEnv("GIVING_INGEST_SECRET", "c".repeat(40));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });
  afterEach(() => vi.unstubAllEnvs());

  const post = async (headers: Record<string, string>, body = '{"id":"evt_1"}') => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    return POST(new Request("https://hooks.example.test/api/stripe/webhook", { method: "POST", headers, body }));
  };

  it("rejects a missing signature", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("rejects a forged signature", async () => {
    expect((await post({ "stripe-signature": "t=1,v1=deadbeef" })).status).toBe(400);
  });

  it("refuses when not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await post({ "stripe-signature": "t=1,v1=x" })).status).toBe(503);
  });
});
