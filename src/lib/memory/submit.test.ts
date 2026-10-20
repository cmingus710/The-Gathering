import { describe, expect, it } from "vitest";
import { SubmissionQueue, toSendResponse, type SendResponse, type SubmitState } from "./submit";

function harness(responses: Array<SendResponse<string> | Error>, opts: { online?: () => boolean } = {}) {
  const states: SubmitState<string>[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let onlineListener: (() => void) | null = null;
  let calls = 0;
  const q = new SubmissionQueue<string>({
    send: async () => {
      const r = responses[Math.min(calls, responses.length - 1)];
      calls++;
      if (r instanceof Error) throw r;
      return r;
    },
    onState: (s) => states.push(s),
    isOnline: opts.online ?? (() => true),
    onOnline: (fn) => {
      onlineListener = fn;
      return () => (onlineListener = null);
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
    maxAttempts: 4,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { q, states, timers, flush, calls: () => calls, goOnline: () => onlineListener?.() };
}

describe("SubmissionQueue", () => {
  it("reports saved only after the server confirms", async () => {
    const h = harness([{ kind: "ok", data: "result" }]);
    h.q.start();
    expect(h.states[0].status).toBe("saving");
    await h.flush();
    expect(h.q.current).toMatchObject({ status: "saved", data: "result", attempt: 1 });
    expect(h.states.map((s) => s.status)).toEqual(["saving", "saved"]);
  });

  it("retries temporary failures with backoff", async () => {
    const h = harness([new Error("network"), { kind: "error", retryable: true, message: "busy" }, { kind: "ok", data: "r" }]);
    h.q.start();
    await h.flush();
    expect(h.q.current.status).toBe("retrying");
    expect(h.timers.map((t) => t.ms)).toEqual([1000]);
    h.timers[0].fn();
    await h.flush();
    expect(h.timers.map((t) => t.ms)).toEqual([1000, 2000]);
    h.timers[1].fn();
    await h.flush();
    expect(h.q.current).toMatchObject({ status: "saved", attempt: 3 });
    expect(h.calls()).toBe(3);
  });

  it("stops on final outcomes without retrying", async () => {
    for (const [r, status] of [
      [{ kind: "signed_out" }, "signed_out"],
      [{ kind: "expired" }, "expired"],
      [{ kind: "conflict" }, "conflict"],
      [{ kind: "error", retryable: false, message: "no" }, "failed"],
    ] as const) {
      const h = harness([r]);
      h.q.start();
      await h.flush();
      expect(h.q.current.status).toBe(status);
      expect(h.timers).toEqual([]);
    }
  });

  it("gives up after the maximum attempts and can be retried by hand", async () => {
    const h = harness([new Error("x")]);
    h.q.start();
    for (let i = 0; i < 3; i++) {
      await h.flush();
      h.timers[i].fn();
    }
    await h.flush();
    expect(h.q.current.status).toBe("failed");
    h.q.start();
    await h.flush();
    expect(h.q.current.attempt).toBe(1);
  });

  it("waits while offline and sends when the connection returns", async () => {
    let online = false;
    const h = harness([{ kind: "ok", data: "r" }], { online: () => online });
    h.q.start();
    expect(h.q.current.status).toBe("offline");
    expect(h.calls()).toBe(0);
    online = true;
    h.goOnline();
    await h.flush();
    expect(h.q.current.status).toBe("saved");
  });

  it("doesn't send twice while one send is running", async () => {
    const h = harness([{ kind: "ok", data: "r" }]);
    h.q.start();
    h.q.start();
    await h.flush();
    expect(h.calls()).toBe(1);
  });
});

describe("toSendResponse", () => {
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it("maps statuses", async () => {
    expect(await toSendResponse(res(200, { a: 1 }))).toEqual({ kind: "ok", data: { a: 1 } });
    expect(await toSendResponse(res(401, {}))).toEqual({ kind: "signed_out" });
    expect(await toSendResponse(res(410, {}))).toEqual({ kind: "expired" });
    expect(await toSendResponse(res(409, {}))).toEqual({ kind: "conflict" });
    expect(await toSendResponse(res(429, { error: "slow down" }))).toEqual({ kind: "error", retryable: true, message: "slow down" });
    expect(await toSendResponse(res(400, { error: "bad" }))).toEqual({ kind: "error", retryable: false, message: "bad" });
    expect(await toSendResponse(res(503, {}))).toMatchObject({ kind: "error", retryable: true });
  });
});
