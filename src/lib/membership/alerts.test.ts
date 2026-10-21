import { describe, expect, it } from "vitest";
import type { CommunityJob } from "@/lib/community/jobs";
import type { Mailer } from "@/lib/events/jobs";
import { APPROVAL_ALERT_SUBJECT, deliverApprovalAlerts, registrationEnvironment, renderApprovalAlert, type ClaimedApprovalAlert } from "./alerts";

const PROFILE = "6f1c1f0e-4c39-4b9e-9a56-0f4f3c1d2e3a";
const alert = (id: string, to: string): ClaimedApprovalAlert => ({
  id,
  to,
  profile_id: PROFILE,
  name: "Sam <Visitor>",
  email: "sam@example.test",
  eligible_at: "2026-11-01T15:30:00Z",
});
const opts = { siteUrl: "https://app.example.test", churchName: "The Gathering", timeZone: "America/Chicago", testMode: false };

describe("approval alert email", () => {
  it("has the agreed subject, the applicant, a church-time timestamp, and a review link", () => {
    const e = renderApprovalAlert(alert("d1", "admin@example.test"), opts);
    expect(e.subject).toBe(APPROVAL_ALERT_SUBJECT);
    expect(e.subject).toBe("New member awaiting approval — The Gathering");
    expect(e.text).toContain("Name: Sam <Visitor>");
    expect(e.text).toContain("Email: sam@example.test");
    expect(e.text).toContain("Requested: Sun, Nov 1, 2026, 9:30 AM CST (America/Chicago)");
    expect(e.text).toContain(`https://app.example.test/admin/members/${PROFILE}`);
    expect(e.html).toContain("Review membership request");
    expect(e.html).toContain(`href="https://app.example.test/admin/members/${PROFILE}"`);
    expect(e.html).toContain("Sam &lt;Visitor&gt;");
    expect(e.html).not.toContain("<Visitor>");
  });

  it("falls back when no name was given and marks test messages", () => {
    const e = renderApprovalAlert({ ...alert("d1", "a@example.test"), name: "  " }, { ...opts, testMode: true });
    expect(e.text).toContain("Name: Name not provided");
    expect(e.subject).toBe(`[TEST] ${APPROVAL_ALERT_SUBJECT}`);
    expect(e.text.startsWith("[TEST MESSAGE")).toBe(true);
  });

  it("never links anywhere but a member record", () => {
    expect(() => renderApprovalAlert({ ...alert("d1", "a@example.test"), profile_id: "../../approve" }, opts)).toThrow();
  });

  it("records where a registration was made", () => {
    expect(registrationEnvironment({ VERCEL_ENV: "production" })).toBe("production");
    expect(registrationEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(registrationEnvironment({})).toBe("development");
  });
});

/** An in-memory stand-in for the database side of the job. */
function fakeQueue(rows: ClaimedApprovalAlert[]) {
  const pending = [...rows];
  const results: Record<string, unknown>[] = [];
  const claims: Record<string, unknown>[] = [];
  const job = (async (op: string, payload: Record<string, unknown>) => {
    if (op === "membership_alert_claim") {
      claims.push(payload);
      return pending.splice(0, Number(payload.limit));
    }
    results.push(payload);
    return { ok: true };
  }) as CommunityJob;
  return { job, results, claims };
}

function fakeMailer(behavior: (to: string) => "ok" | "transient" | "permanent" | "throw" | "hang") {
  const sent: { to: string; idempotencyKey: string; subject: string }[] = [];
  const mailer: Mailer = {
    async send(m) {
      sent.push({ to: m.to, idempotencyKey: m.idempotencyKey, subject: m.subject });
      const b = behavior(m.to);
      if (b === "throw") throw Object.assign(new Error("socket hang up"), { name: "FetchError" });
      if (b === "hang") return new Promise(() => {});
      if (b === "transient") return { ok: false, error: "rate_limit_exceeded" };
      if (b === "permanent") return { ok: false, error: "validation_error" };
      return { ok: true, id: `re_${m.to}` };
    },
  };
  return { mailer, sent };
}

const deps = (job: CommunityJob, mailer: Mailer | null, extra: Partial<Parameters<typeof deliverApprovalAlerts>[0]> = {}) => ({
  job,
  mailer,
  allowlist: null,
  ...opts,
  ...extra,
});

describe("approval alert delivery", () => {
  it("sends one separate message per recipient, each with its own idempotency key", async () => {
    const q = fakeQueue([alert("d1", "one@example.test"), alert("d2", "two@example.test")]);
    const m = fakeMailer(() => "ok");
    const report = await deliverApprovalAlerts(deps(q.job, m.mailer));
    expect(report).toEqual({ sent: 2, failed: 0, suppressed: 0 });
    expect(m.sent.map((s) => s.to)).toEqual(["one@example.test", "two@example.test"]);
    expect(m.sent.map((s) => s.idempotencyKey)).toEqual(["membership-alert-d1", "membership-alert-d2"]);
    expect(q.results).toEqual([
      { id: "d1", status: "sent", provider_id: "re_one@example.test" },
      { id: "d2", status: "sent", provider_id: "re_two@example.test" },
    ]);
    expect(q.claims[0]).toMatchObject({ test: false });
  });

  it("records a partial failure per recipient: transient retries, permanent doesn't", async () => {
    const q = fakeQueue([alert("d1", "ok@example.test"), alert("d2", "busy@example.test"), alert("d3", "bad@example.test"), alert("d4", "down@example.test")]);
    const m = fakeMailer((to) => (to.startsWith("busy") ? "transient" : to.startsWith("bad") ? "permanent" : to.startsWith("down") ? "throw" : "ok"));
    const report = await deliverApprovalAlerts(deps(q.job, m.mailer));
    expect(report).toEqual({ sent: 1, failed: 3, suppressed: 0 });
    expect(q.results).toEqual([
      { id: "d1", status: "sent", provider_id: "re_ok@example.test" },
      { id: "d2", status: "failed", error: "rate_limit_exceeded", retry: true },
      { id: "d3", status: "failed", error: "validation_error", retry: false },
      { id: "d4", status: "failed", error: "FetchError" },
    ]);
  });

  it("treats a provider timeout as a retryable failure", async () => {
    const q = fakeQueue([alert("d1", "slow@example.test")]);
    const m = fakeMailer(() => "hang");
    const report = await deliverApprovalAlerts(deps(q.job, m.mailer, { timeoutMs: 20 }));
    expect(report.failed).toBe(1);
    expect(q.results).toEqual([{ id: "d1", status: "failed", error: "TimeoutError" }]);
  });

  it("outside production claims only test alerts and sends only to the allowlist", async () => {
    const q = fakeQueue([alert("d1", "tester@example.test"), alert("d2", "real-admin@example.test")]);
    const m = fakeMailer(() => "ok");
    const report = await deliverApprovalAlerts(deps(q.job, m.mailer, { testMode: true, allowlist: ["tester@example.test"] }));
    expect(q.claims[0]).toMatchObject({ test: true });
    expect(report).toEqual({ sent: 1, failed: 0, suppressed: 1 });
    expect(m.sent.map((s) => s.to)).toEqual(["tester@example.test"]);
    expect(m.sent[0].subject.startsWith("[TEST]")).toBe(true);
    expect(q.results[1]).toEqual({ id: "d2", status: "suppressed", error: "Not on the test allowlist" });
  });

  it("leaves alerts queued when email isn't configured", async () => {
    const q = fakeQueue([alert("d1", "one@example.test")]);
    expect(await deliverApprovalAlerts(deps(q.job, null))).toEqual({ sent: 0, failed: 0, suppressed: 0 });
    expect(q.claims).toHaveLength(0);
  });
});
