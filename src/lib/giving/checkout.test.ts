import { describe, expect, it, vi } from "vitest";
import { issueRefund } from "./checkout";
import type { GivingServer } from "./server";

function server(retrieve: () => Promise<unknown>) {
  const create = vi.fn(async () => ({ id: "re_test_1", status: "succeeded" }));
  const ingest = vi.fn(async () => ({ jobs: [] }));
  const s = {
    stripe: { refunds: { create, retrieve } },
    ingest,
    mailer: null,
    siteUrl: "https://example.test",
    emailAllowlist: [],
    config: {},
  } as unknown as GivingServer;
  return { s, create };
}

describe("issueRefund", () => {
  it("reports Stripe's result even when recording the refund fails afterwards", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { s, create } = server(async () => {
      throw Object.assign(new Error("denied"), { type: "StripePermissionError" });
    });
    await expect(issueRefund(s, { payment_intent_id: "pi_test_1", charge_id: null }, 1000, "tok", "pay-1", "actor-1")).resolves.toBe("succeeded");
    expect(create).toHaveBeenCalledWith(
      { payment_intent: "pi_test_1", amount: 1000, reason: "requested_by_customer" },
      { idempotencyKey: "gathering-refund-pay-1-tok" },
    );
  });

  it("fails when Stripe refuses the refund itself", async () => {
    const { s, create } = server(async () => ({}));
    create.mockRejectedValueOnce(Object.assign(new Error("denied"), { type: "StripePermissionError" }));
    await expect(issueRefund(s, { payment_intent_id: null, charge_id: "ch_test_1" }, 500, "tok", "pay-2", "actor-1")).rejects.toThrow("denied");
  });
});
