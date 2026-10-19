import { describe, expect, it } from "vitest";
import { renderEventEmail } from "./emails";
import { signJob, verifyJobSignature, type ClaimedEmail } from "./jobs";

const SECRET = "s".repeat(48);

describe("events job signature", () => {
  it("accepts a fresh, correctly signed tick and nothing else", () => {
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const sig = signJob(SECRET, "tick", Number(ts), "");
    expect(verifyJobSignature(SECRET, "tick", ts, sig, "", now)).toBe(true);
    expect(verifyJobSignature(SECRET, "tick", ts, sig.replace(/^./, sig[0] === "a" ? "b" : "a"), "", now)).toBe(false);
    expect(verifyJobSignature("x".repeat(48), "tick", ts, sig, "", now)).toBe(false);
    expect(verifyJobSignature(SECRET, "email_claim", ts, sig, "", now)).toBe(false);
    expect(verifyJobSignature(SECRET, "tick", String(Number(ts) - 400), signJob(SECRET, "tick", Number(ts) - 400, ""), "", now)).toBe(false);
    expect(verifyJobSignature(SECRET, "tick", null, sig, "", now)).toBe(false);
    expect(verifyJobSignature(SECRET, "tick", ts, "not-hex", "", now)).toBe(false);
  });
});

const claimed = (over: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  id: "m1",
  kind: "rsvp_confirmed",
  dedupe_key: "confirmed:r1:1",
  detail: {},
  to: "member@example.test",
  first_name: "Sam",
  occurrence: {
    id: "o1",
    series_id: "s1",
    occurrence_key: "2026-11-01",
    starts_at: "2026-11-01T15:00:00Z",
    ends_at: "2026-11-01T16:00:00Z",
    local_date: "2026-11-01",
    status: "scheduled",
    series_status: "published",
    title: "Synthetic <Supper>",
    description: "",
    cover_path: null,
    cover_alt: null,
    category: null,
    audience: "members",
    timezone: "America/Chicago",
    all_day: false,
    day_count: null,
    location_name: "Synthetic Hall",
    location_address: null,
    online_url: null,
    organizer_name: "Private Organizer Name",
    note: null,
    cancel_reason: null,
    cancellation_instructions: "Cancel on the event page.",
    rsvp_enabled: true,
    waitlist_enabled: true,
    rsvp_closes_at: "2026-11-01T15:00:00Z",
    spots_left: 3,
    recurring: false,
    sequence: 0,
    updated_at: "2026-10-20T00:00:00Z",
    my_status: "confirmed",
    my_position: null,
  },
  ...over,
});

describe("event emails", () => {
  const opts = { siteUrl: "https://example.test", churchName: "The Gathering", testMode: true };

  it("marks test messages, escapes content, and links to the event", () => {
    const e = renderEventEmail(claimed(), opts);
    expect(e.subject).toBe("[TEST] You're registered: Synthetic <Supper>");
    expect(e.html).toContain("Synthetic &lt;Supper&gt;");
    expect(e.html).not.toContain("<Supper>");
    expect(e.text).toContain("https://example.test/events/o1");
    expect(e.text).toContain("Sunday, November 1, 2026 · 9:00 AM – 10:00 AM CST");
    expect(e.text).not.toContain("Private Organizer Name");
  });

  it("explains that a promotion confirms the place automatically", () => {
    const e = renderEventEmail(claimed({ kind: "promoted" }), { ...opts, testMode: false });
    expect(e.subject).toBe("A place opened up: Synthetic <Supper>");
    expect(e.text).toMatch(/Your place is confirmed/);
  });

  it("covers waitlist, change, cancellation, and reminder messages", () => {
    expect(renderEventEmail(claimed({ kind: "waitlisted", occurrence: { ...claimed().occurrence, my_position: 2 } }), opts).text).toContain("number 2");
    expect(renderEventEmail(claimed({ kind: "changed", detail: { fields: ["time"] } }), opts).text).toContain("date or time");
    expect(renderEventEmail(claimed({ kind: "event_canceled", occurrence: { ...claimed().occurrence, cancel_reason: "Synthetic storm" } }), opts).subject).toBe("[TEST] Canceled: Synthetic <Supper>");
    expect(renderEventEmail(claimed({ kind: "reminder", detail: { minutes: 1440 } }), opts).text).toContain("1 day away");
  });
});
