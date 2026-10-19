import { describe, expect, it } from "vitest";
import { checkStripeKey, getGivingConfig, parseAllowlist } from "./config";

const ingest = "x".repeat(40);

describe("giving configuration safeguards", () => {
  it("accepts only Stripe test-mode keys", () => {
    expect(checkStripeKey("sk_test_" + "a".repeat(24))).toMatchObject({ ok: true });
    expect(checkStripeKey("rk_test_" + "a".repeat(24))).toMatchObject({ ok: true });
    expect(checkStripeKey("sk_live_" + "a".repeat(24))).toEqual({ ok: false, reason: "live_blocked" });
    expect(checkStripeKey("rk_live_" + "a".repeat(24))).toEqual({ ok: false, reason: "live_blocked" });
    expect(checkStripeKey("pk_test_" + "a".repeat(24))).toEqual({ ok: false, reason: "invalid" });
    expect(checkStripeKey(undefined)).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses to run without the ingest secret, and ignores malformed webhook secrets", () => {
    expect(getGivingConfig({ STRIPE_SECRET_KEY: "sk_test_" + "a".repeat(24) })).toEqual({ ok: false, reason: "ingest_not_configured" });
    expect(getGivingConfig({ STRIPE_SECRET_KEY: "sk_live_" + "a".repeat(24), GIVING_INGEST_SECRET: ingest })).toMatchObject({ ok: false });
    const ok = getGivingConfig({ STRIPE_SECRET_KEY: "sk_test_" + "a".repeat(24), GIVING_INGEST_SECRET: ingest, STRIPE_WEBHOOK_SECRET: "nope" });
    expect(ok.ok && ok.config.webhookSecret).toBeNull();
  });

  it("parses the test-email allowlist", () => {
    expect(parseAllowlist(" A@Example.test, bad, b@example.test ,")).toEqual(["a@example.test", "b@example.test"]);
  });
});
