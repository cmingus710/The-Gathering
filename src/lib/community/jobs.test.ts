import { describe, expect, it } from "vitest";
import { signJob } from "@/lib/events/jobs";
import { renderCommunityEmail, safeAppUrl } from "./emails";
import { createCommunityJob, deliverCommunityEmails, signCommunityJob, type ClaimedCommunityEmail } from "./jobs";

describe("community job signing", () => {
  it("can't be confused with an events job signature", () => {
    expect(signCommunityJob("s".repeat(40), "tick", 1, "{}")).not.toBe(signJob("s".repeat(40), "tick", 1, "{}"));
  });

  it("signs op, timestamp, and payload", async () => {
    let seen: { p_sig: string; p_ts: number; p_payload: string } | null = null;
    const job = createCommunityJob("k".repeat(40), async (a) => ((seen = a), { data: { ok: true }, error: null }), () => 1_700_000_000_000);
    await job("tick", { a: 1 });
    expect(seen!.p_ts).toBe(1_700_000_000);
    expect(seen!.p_sig).toBe(signCommunityJob("k".repeat(40), "tick", 1_700_000_000, '{"a":1}'));
  });
});

const message: ClaimedCommunityEmail = {
  id: "1",
  kind: "immediate",
  dedupe_key: "n:1",
  weekly: false,
  to: "member@example.test",
  first_name: "Sam",
  items: [{ kind: "message", category: "messages", title: "You have a new message", url: "/messages/abc" }],
};

describe("community email", () => {
  it("says only that a message arrived, marked as a test", () => {
    const e = renderCommunityEmail(message, { siteUrl: "https://app.example", churchName: "The Gathering", testMode: true });
    expect(e.subject).toBe("[TEST] You have a new message");
    expect(e.text).toContain("https://app.example/messages/abc");
    expect(e.html).not.toMatch(/<script/i);
  });

  it("escapes titles and refuses off-site links", () => {
    const e = renderCommunityEmail(
      { ...message, kind: "digest", items: [{ kind: "reply_followed", category: "forum", title: "<b>x</b>", url: "https://evil.example" }] },
      { siteUrl: "https://app.example", churchName: "The Gathering", testMode: false },
    );
    expect(e.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(e.html).not.toContain("evil.example");
    expect(safeAppUrl("https://app.example", "//evil.example")).toBe("https://app.example/notifications");
  });

  it("suppresses addresses outside the test allowlist and records results", async () => {
    const results: unknown[] = [];
    const sent: string[] = [];
    let claims = 0;
    const report = await deliverCommunityEmails({
      job: (async (op: string, payload: Record<string, unknown>) => {
        if (op === "email_claim") return claims++ === 0 ? [message, { ...message, id: "2", to: "allowed@example.test" }] : [];
        results.push({ op, ...payload });
        return {};
      }) as never,
      mailer: { send: async (m) => (sent.push(m.to), { ok: true, id: "re_1" }) },
      push: null,
      allowlist: ["allowed@example.test"],
      siteUrl: "https://app.example",
      churchName: "The Gathering",
      testMode: true,
    });
    expect(sent).toEqual(["allowed@example.test"]);
    expect(report).toMatchObject({ sent: 1, suppressed: 1 });
    expect(results).toContainEqual(expect.objectContaining({ id: "1", status: "suppressed" }));
  });
});
