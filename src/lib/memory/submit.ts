/**
 * Sends one practice submission to the server and keeps trying until it is
 * stored or a final answer comes back. No browser storage: the answer lives
 * in memory on the page until the server confirms it.
 *
 *   - "saved" only after the server confirms the result (a retry of a
 *     session that was already stored returns the stored result, so a
 *     response lost on the way back is never counted twice);
 *   - temporary failures (network, timeouts, 5xx, rate limits) retry with
 *     backoff, and a browser that reports itself offline waits for the
 *     connection instead of burning attempts;
 *   - final outcomes stop retrying: signed out (401), expired activity (410),
 *     the verse changed or was removed (409), or a request the server won't
 *     accept (400/403/404).
 */
export type SubmitStatus = "unsaved" | "saving" | "retrying" | "offline" | "saved" | "signed_out" | "expired" | "conflict" | "failed";

export type SendResponse<T> =
  | { kind: "ok"; data: T }
  | { kind: "signed_out" }
  | { kind: "expired" }
  | { kind: "conflict" }
  | { kind: "error"; retryable: boolean; message: string };

export type SubmitState<T> = { status: SubmitStatus; attempt: number; message: string | null; data: T | null };

type Timer = ReturnType<typeof setTimeout>;

export type SubmitOptions<T> = {
  send: () => Promise<SendResponse<T>>;
  onState: (state: SubmitState<T>) => void;
  retryDelaysMs?: number[];
  /** Attempts before giving up and offering a manual retry. */
  maxAttempts?: number;
  isOnline?: () => boolean;
  onOnline?: (fn: () => void) => () => void;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
};

export class SubmissionQueue<T> {
  private state: SubmitState<T> = { status: "unsaved", attempt: 0, message: null, data: null };
  private timer: Timer | null = null;
  private unlisten: (() => void) | null = null;
  private running = false;
  private stopped = false;
  private readonly o: Required<Omit<SubmitOptions<T>, "send" | "onState">> & Pick<SubmitOptions<T>, "send" | "onState">;

  constructor(options: SubmitOptions<T>) {
    this.o = {
      retryDelaysMs: [1000, 2000, 5000, 10000, 30000],
      maxAttempts: 8,
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
      onOnline: (fn) => {
        if (typeof window === "undefined") return () => {};
        window.addEventListener("online", fn);
        return () => window.removeEventListener("online", fn);
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t),
      ...(Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as SubmitOptions<T>),
    } as SubmissionQueue<T>["o"];
  }

  get current(): SubmitState<T> {
    return this.state;
  }

  /** Starts (or restarts, after a final failure) sending. */
  start() {
    if (this.running || this.state.status === "saved") return;
    this.stopped = false;
    this.state = { ...this.state, attempt: 0 };
    void this.attempt();
  }

  /** Stops retrying (for example, when the page unmounts). */
  dispose() {
    this.stopped = true;
    if (this.timer) this.o.clearTimer(this.timer);
    this.timer = null;
    this.unlisten?.();
    this.unlisten = null;
  }

  private set(next: Partial<SubmitState<T>>) {
    this.state = { ...this.state, ...next };
    this.o.onState(this.state);
  }

  private async attempt() {
    if (this.stopped) return;
    if (!this.o.isOnline()) {
      this.set({ status: "offline", message: null });
      this.unlisten?.();
      this.unlisten = this.o.onOnline(() => {
        this.unlisten?.();
        this.unlisten = null;
        void this.attempt();
      });
      return;
    }
    this.running = true;
    const attempt = this.state.attempt + 1;
    this.set({ status: attempt === 1 ? "saving" : "retrying", attempt, message: null });
    let r: SendResponse<T>;
    try {
      r = await this.o.send();
    } catch {
      r = { kind: "error", retryable: true, message: "The connection was interrupted." };
    }
    this.running = false;
    if (this.stopped) return;
    switch (r.kind) {
      case "ok":
        this.set({ status: "saved", data: r.data, message: null });
        return;
      case "signed_out":
        this.set({ status: "signed_out", message: null });
        return;
      case "expired":
        this.set({ status: "expired", message: null });
        return;
      case "conflict":
        this.set({ status: "conflict", message: null });
        return;
      case "error":
        if (!r.retryable || attempt >= this.o.maxAttempts) {
          this.set({ status: "failed", message: r.message });
          return;
        }
        this.set({ status: "retrying", message: r.message });
        this.timer = this.o.setTimer(() => {
          this.timer = null;
          void this.attempt();
        }, this.o.retryDelaysMs[Math.min(attempt - 1, this.o.retryDelaysMs.length - 1)]);
    }
  }
}

/** Maps an HTTP response from /api/memory/* to a send result. */
export async function toSendResponse<T>(res: Response): Promise<SendResponse<T>> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const message = (body as { error?: string } | null)?.error ?? "That couldn't be saved right now.";
  if (res.ok) return { kind: "ok", data: body as T };
  if (res.status === 401) return { kind: "signed_out" };
  if (res.status === 410) return { kind: "expired" };
  if (res.status === 409) return { kind: "conflict" };
  return { kind: "error", retryable: res.status >= 500 || res.status === 429 || res.status === 408, message };
}
