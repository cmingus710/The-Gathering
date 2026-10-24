import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveController, statusLabel, type AutosaveState, type SaveRequest, type SaveResponse } from "./autosave";

type Pending = { req: SaveRequest; resolve: (r: SaveResponse) => void; reject: (e: unknown) => void };

function setup(opts: { online?: () => boolean } = {}) {
  const calls: Pending[] = [];
  const states: AutosaveState[] = [];
  const c = new AutosaveController({
    initial: { title: "T", body: "B", version: 1, updatedAt: "2026-10-20T00:00:00Z" },
    save: (req) => new Promise((resolve, reject) => calls.push({ req, resolve, reject })),
    onState: (s) => states.push(s),
    debounceMs: 1000,
    retryDelaysMs: [500, 1000],
    isOnline: opts.online,
  });
  return { c, calls, states, status: () => c.current.status };
}
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("AutosaveController", () => {
  it("debounces edits and claims Saved only after the server confirms", async () => {
    const { c, calls, status } = setup();
    c.edit({ title: "T", body: "B1" });
    c.edit({ title: "T", body: "B12" });
    expect(status()).toBe("unsaved");
    expect(c.dirty).toBe(true);
    vi.advanceTimersByTime(999);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].req).toMatchObject({ body: "B12", baseVersion: 1, force: false });
    expect(status()).toBe("saving");
    calls[0].resolve({ kind: "saved", version: 2, updatedAt: "x" });
    await vi.waitFor(() => expect(status()).toBe("saved"));
    expect(c.current.version).toBe(2);
    expect(c.dirty).toBe(false);
  });

  it("never lets an older save overwrite newer text: one save in flight, then the latest", async () => {
    const { c, calls, status } = setup();
    c.edit({ title: "T", body: "first" });
    vi.advanceTimersByTime(1000);
    c.edit({ title: "T", body: "second" }); // typed while saving
    vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(1); // not sent concurrently
    calls[0].resolve({ kind: "saved", version: 2, updatedAt: "x" });
    await vi.waitFor(() => expect(status()).toBe("unsaved"));
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(2);
    expect(calls[1].req).toMatchObject({ body: "second", baseVersion: 2 });
    calls[1].resolve({ kind: "saved", version: 3, updatedAt: "y" });
    await vi.waitFor(() => expect(status()).toBe("saved"));
  });

  it("retries temporary failures with backoff and keeps the text", async () => {
    const { c, calls, status } = setup();
    c.edit({ title: "T", body: "keep me" });
    vi.advanceTimersByTime(1000);
    calls[0].resolve({ kind: "error", retryable: true, message: "Network error." });
    await vi.waitFor(() => expect(status()).toBe("failed"));
    expect(statusLabel(c.current)).toBe("Not saved");
    vi.advanceTimersByTime(500);
    expect(calls).toHaveLength(2);
    expect(calls[1].req.body).toBe("keep me");
    calls[1].reject(new Error("socket hang up"));
    await vi.waitFor(() => expect(c.current.attempt).toBe(2));
    vi.advanceTimersByTime(1000);
    calls[2].resolve({ kind: "saved", version: 2, updatedAt: "z" });
    await vi.waitFor(() => expect(status()).toBe("saved"));
  });

  it("schedules nothing after dispose, even when a save that was in flight fails", async () => {
    const { c, calls, states } = setup();
    c.edit({ title: "T", body: "B1" });
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
    c.dispose();
    const before = states.length;
    calls[0].resolve({ kind: "error", retryable: true, message: "Network" });
    await flushMicrotasks();
    vi.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(1);
    expect(states.length).toBe(before);
    // Remounted with the same controller: the next edit works as usual.
    c.edit({ title: "T", body: "B2" });
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(2);
    calls[1].resolve({ kind: "saved", version: 2, updatedAt: "x" });
    await vi.waitFor(() => expect(c.current.status).toBe("saved"));
  });

  it("stops on a non-retryable error until the member acts", async () => {
    const { c, calls, status } = setup();
    c.edit({ title: "T", body: "x".repeat(10) });
    vi.advanceTimersByTime(1000);
    calls[0].resolve({ kind: "error", retryable: false, message: "This entry is too long to save." });
    await vi.waitFor(() => expect(status()).toBe("failed"));
    vi.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(1);
  });

  it("offers keep mine, use saved, and keep both on a conflict", async () => {
    const { c, calls, status } = setup();
    c.edit({ title: "T", body: "mine" });
    vi.advanceTimersByTime(1000);
    calls[0].resolve({ kind: "conflict", current: { title: "T", body: "theirs", version: 5, updatedAt: "w" } });
    await vi.waitFor(() => expect(status()).toBe("conflict"));
    c.edit({ title: "T", body: "mine, edited" });
    vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(1); // paused while in conflict
    expect(c.text.body).toBe("mine, edited"); // keep both: the caller saves this as a new entry
    c.keepMine();
    await flushMicrotasks();
    expect(calls[1].req).toMatchObject({ body: "mine, edited", baseVersion: 5, force: true });
    calls[1].resolve({ kind: "saved", version: 6, updatedAt: "v" });
    await vi.waitFor(() => expect(status()).toBe("saved"));

    c.edit({ title: "T", body: "again" });
    vi.advanceTimersByTime(1000);
    calls[2].resolve({ kind: "conflict", current: { title: "T2", body: "newer", version: 9, updatedAt: "u" } });
    await vi.waitFor(() => expect(status()).toBe("conflict"));
    expect(c.useSaved()).toEqual({ title: "T2", body: "newer" });
    expect(c.current).toMatchObject({ status: "saved", version: 9 });
  });

  it("keeps the text when the session expires and resumes after sign-in", async () => {
    const { c, calls, status } = setup();
    c.edit({ title: "T", body: "don't lose this" });
    vi.advanceTimersByTime(1000);
    calls[0].resolve({ kind: "signed_out" });
    await vi.waitFor(() => expect(status()).toBe("signed_out"));
    vi.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(1);
    expect(c.dirty).toBe(true);
    c.resume();
    await flushMicrotasks();
    expect(calls[1].req.body).toBe("don't lose this");
  });

  it("waits while offline instead of pretending to sync", async () => {
    let online = false;
    const { c, calls, status } = setup({ online: () => online });
    c.edit({ title: "T", body: "offline words" });
    vi.advanceTimersByTime(1000);
    expect(status()).toBe("offline");
    expect(calls).toHaveLength(0);
    online = true;
    c.resume();
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
  });

  it("returns to Saved when the text is put back as it was", () => {
    const { c, status } = setup();
    c.edit({ title: "T", body: "changed" });
    c.edit({ title: "T", body: "B" });
    expect(status()).toBe("saved");
    vi.advanceTimersByTime(5000);
  });
});
