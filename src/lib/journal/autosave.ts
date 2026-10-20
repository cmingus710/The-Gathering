/**
 * Account-backed autosave for journal entries (no browser storage).
 *
 * Status is never "saved" until the server confirms the exact text that is
 * on screen. The controller:
 *   - debounces edits (default 1.2 s) and keeps at most one save in flight;
 *     edits made while a save is in flight are sent right after it, so an
 *     older response can never overwrite newer text, and every save names
 *     the version it was based on (optimistic concurrency);
 *   - retries temporary failures (network, timeouts, 5xx, rate limits) with
 *     backoff, and waits for the connection when the browser is offline;
 *   - stops on a conflict (another tab or device saved first) and offers
 *     three explicit choices: keep mine (overwrite), use the saved text, or
 *     keep both (the caller saves mine as a new entry);
 *   - stops when the session has expired, keeping the text on screen, and
 *     resumes when the member retries after signing in again.
 * It holds the text in memory only.
 */
export type SaveStatus = "saved" | "unsaved" | "saving" | "retrying" | "failed" | "offline" | "conflict" | "signed_out";

export type Draft = { title: string; body: string };

export type SaveResponse =
  | { kind: "saved"; version: number; updatedAt: string }
  | { kind: "conflict"; current: Draft & { version: number; updatedAt: string } }
  | { kind: "signed_out" }
  | { kind: "error"; retryable: boolean; message: string };

export type SaveRequest = Draft & { baseVersion: number; force: boolean };

export type AutosaveState = {
  status: SaveStatus;
  version: number;
  savedAt: string | null;
  message: string | null;
  conflict: (Draft & { version: number; updatedAt: string }) | null;
  attempt: number;
};

type Timer = ReturnType<typeof setTimeout>;

export type AutosaveOptions = {
  initial: Draft & { version: number; updatedAt: string | null };
  save: (req: SaveRequest) => Promise<SaveResponse>;
  onState: (state: AutosaveState) => void;
  debounceMs?: number;
  /** Backoff delays for temporary failures (the last repeats). */
  retryDelaysMs?: number[];
  isOnline?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
};

const same = (a: Draft, b: Draft) => a.title === b.title && a.body === b.body;

export class AutosaveController {
  private draft: Draft;
  private saved: Draft;
  private state: AutosaveState;
  private inFlight = false;
  private force = false;
  private debounce: Timer | null = null;
  private retry: Timer | null = null;
  private readonly opts: Required<Omit<AutosaveOptions, "initial">>;

  constructor(options: AutosaveOptions) {
    this.opts = {
      debounceMs: 1200,
      retryDelaysMs: [1000, 2000, 5000, 10000, 30000],
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t),
      ...(Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as Partial<AutosaveOptions>),
    } as Required<Omit<AutosaveOptions, "initial">>;
    this.draft = { title: options.initial.title, body: options.initial.body };
    this.saved = { ...this.draft };
    this.state = { status: "saved", version: options.initial.version, savedAt: options.initial.updatedAt, message: null, conflict: null, attempt: 0 };
  }

  get current(): AutosaveState {
    return this.state;
  }

  /** True when the text on screen isn't confirmed saved (warn before leaving). */
  get dirty(): boolean {
    return !same(this.draft, this.saved) || this.inFlight;
  }

  private set(patch: Partial<AutosaveState>) {
    this.state = { ...this.state, ...patch };
    this.opts.onState(this.state);
  }

  private clearTimers() {
    if (this.debounce) this.opts.clearTimer(this.debounce);
    if (this.retry) this.opts.clearTimer(this.retry);
    this.debounce = this.retry = null;
  }

  /** The member typed. */
  edit(draft: Draft) {
    this.draft = { ...draft };
    if (this.state.status === "conflict" || this.state.status === "signed_out") return; // paused until resolved
    if (same(this.draft, this.saved) && !this.inFlight) {
      this.clearTimers();
      this.set({ status: "saved", message: null });
      return;
    }
    if (!this.inFlight) this.set({ status: "unsaved", message: null });
    if (this.debounce) this.opts.clearTimer(this.debounce);
    this.debounce = this.opts.setTimer(() => void this.flush(), this.opts.debounceMs);
  }

  /** Save now (blur, Ctrl+S, before leaving, the Retry button). */
  async flush(): Promise<void> {
    if (this.debounce) this.opts.clearTimer(this.debounce);
    this.debounce = null;
    if (this.inFlight || this.state.status === "conflict") return;
    if (same(this.draft, this.saved) && !this.force) {
      if (this.state.status !== "saved") this.set({ status: "saved", message: null, attempt: 0 });
      return;
    }
    if (!this.opts.isOnline()) {
      this.set({ status: "offline", message: "You're offline. Your text is still here and will save when you reconnect." });
      return;
    }
    const sent: Draft = { ...this.draft };
    this.inFlight = true;
    this.set({ status: this.state.attempt > 0 ? "retrying" : "saving" });
    let res: SaveResponse;
    try {
      res = await this.opts.save({ ...sent, baseVersion: this.state.version, force: this.force });
    } catch {
      res = { kind: "error", retryable: true, message: "The connection was interrupted." };
    }
    this.inFlight = false;
    switch (res.kind) {
      case "saved":
        this.force = false;
        this.saved = sent;
        this.set({ version: res.version, savedAt: res.updatedAt, attempt: 0, message: null });
        // Typed more while saving: save that too.
        if (!same(this.draft, this.saved)) {
          this.set({ status: "unsaved" });
          this.debounce = this.opts.setTimer(() => void this.flush(), this.opts.debounceMs);
        } else {
          this.set({ status: "saved" });
        }
        return;
      case "conflict":
        this.clearTimers();
        this.set({ status: "conflict", conflict: res.current, message: "This entry was changed in another tab or on another device." });
        return;
      case "signed_out":
        this.clearTimers();
        this.set({ status: "signed_out", message: "Your session has ended. Your text is still here: sign in again in another tab, then choose Retry." });
        return;
      case "error": {
        if (!res.retryable) {
          this.set({ status: "failed", message: res.message, attempt: 0 });
          return;
        }
        const attempt = this.state.attempt + 1;
        const delays = this.opts.retryDelaysMs;
        const delay = delays[Math.min(attempt - 1, delays.length - 1)];
        this.set({ status: "failed", attempt, message: `${res.message} Trying again…` });
        this.retry = this.opts.setTimer(() => void this.flush(), delay);
        return;
      }
    }
  }

  /** Call when the browser comes back online or the member presses Retry. */
  resume() {
    if (this.state.status === "conflict") return;
    if (this.state.status === "signed_out") this.set({ status: "unsaved", message: null });
    this.set({ attempt: 0 });
    void this.flush();
  }

  /** Conflict choice: overwrite the other version with the text on screen. */
  keepMine() {
    const c = this.state.conflict;
    if (!c) return;
    this.force = true;
    this.set({ status: "unsaved", conflict: null, version: c.version, message: null, attempt: 0 });
    void this.flush();
  }

  /** Conflict choice: discard the text on screen and use the saved version. */
  useSaved(): Draft | null {
    const c = this.state.conflict;
    if (!c) return null;
    this.draft = { title: c.title, body: c.body };
    this.saved = { ...this.draft };
    this.set({ status: "saved", conflict: null, version: c.version, savedAt: c.updatedAt, message: null, attempt: 0 });
    return { ...this.draft };
  }

  /** Text on screen (for "keep both", the caller saves this as a new entry first). */
  get text(): Draft {
    return { ...this.draft };
  }

  dispose() {
    this.clearTimers();
  }
}

/** Label for the status line. */
export function statusLabel(s: AutosaveState): string {
  switch (s.status) {
    case "saved":
      return "Saved";
    case "unsaved":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "retrying":
      return "Saving (retrying)…";
    case "failed":
      return "Not saved";
    case "offline":
      return "Offline, not saved";
    case "conflict":
      return "Not saved: changed elsewhere";
    case "signed_out":
      return "Not saved: signed out";
  }
}
