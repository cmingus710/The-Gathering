import { describe, expect, it } from "vitest";
import { renderGivingEmail, type EmailJob } from "./emails";

const job: EmailJob = {
  id: "1", kind: "acknowledgment", dedupe_key: "ack:1", to: "donor@example.test", livemode: false, recovery_url: null,
  first_name: "Sam", is_guest: true, amount_cents: 5000, payment_amount_cents: 5000, fund_name: "Missions", frequency: "monthly",
  received_at: "2026-03-01T15:00:00Z", next_payment_at: null, claim_code: "ABCDE-12345", acknowledgment_message: "Thank you <b>friend</b>",
  church_name: "The Gathering", timezone: "America/Chicago",
};

describe("giving emails", () => {
  it("marks test-mode email clearly", () => {
    const m = renderGivingEmail(job, "https://app.example.test");
    expect(m.subject).toBe("[TEST] Thank you for your gift");
    expect(m.text).toContain("TEST EMAIL");
    expect(renderGivingEmail({ ...job, livemode: true }, "https://x").subject).toBe("Thank you for your gift");
  });

  it("never claims tax deductibility and escapes configured wording", () => {
    const m = renderGivingEmail(job, "https://app.example.test");
    expect(`${m.text} ${m.html}`.toLowerCase()).not.toMatch(/tax[- ]deductible|deductib/);
    expect(m.html).toContain("Thank you &lt;b&gt;friend&lt;/b&gt;");
    expect(m.text).toContain("$50.00");
  });

  it("includes the claim reference only for guests", () => {
    expect(renderGivingEmail(job, "https://x").text).toContain("ABCDE-12345");
    const member = renderGivingEmail({ ...job, is_guest: false, claim_code: null }, "https://app.example.test");
    expect(member.text).not.toContain("Gift reference");
    expect(member.text).toContain("https://app.example.test/giving");
  });

  it("gives guests a recovery link and members the giving page for failed renewals", () => {
    const guest = renderGivingEmail({ ...job, kind: "payment_failed", recovery_url: "https://invoice.stripe.example/pay" }, "https://x");
    expect(guest.text).toContain("https://invoice.stripe.example/pay");
    const member = renderGivingEmail({ ...job, kind: "payment_failed", is_guest: false }, "https://app.example.test");
    expect(member.text).toContain("https://app.example.test/giving");
  });
});
