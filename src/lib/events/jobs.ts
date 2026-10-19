import { createHmac, timingSafeEqual } from "node:crypto";
import { renderEventEmail } from "./emails";
import type { EventOccurrence } from "./types";

/**
 * Client for public.events_job(): the scheduler tick and email delivery.
 * Calls are signed with EVENTS_JOB_SECRET (shared with the database as
 * events.secrets('job')) over "<op>.<timestamp>.<payload>"; the database
 * refuses unsigned, mis-signed, or stale (> 5 min) calls.
 */
export type JobOp = "tick" | "email_claim" | "email_result";
export type EventsJob = <T = unknown>(op: JobOp, payload: Record<string, unknown>) => Promise<T>;

export class JobError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export function signJob(secret: string, op: string, ts: number, payload: string): string {
  return createHmac("sha256", secret).update(`${op}.${ts}.${payload}`).digest("hex");
}

/** Verifies a signed request to /api/jobs/events (same scheme, any op). */
export function verifyJobSignature(secret: string, op: string, ts: string | null, sig: string | null, payload = "", now = Date.now()): boolean {
  if (!ts || !sig || !/^\d{1,12}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const expected = Buffer.from(signJob(secret, op, Number(ts), payload), "hex");
  const given = Buffer.from(sig, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type JobRpc = (args: { p_op: string; p_payload: string; p_ts: number; p_sig: string }) => Promise<{
  data: unknown;
  error: { message?: string; code?: string } | null;
}>;

export function createEventsJob(secret: string, rpc: JobRpc, now: () => number = () => Date.now()): EventsJob {
  return async <T>(op: JobOp, payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    const ts = Math.floor(now() / 1000);
    const { data, error } = await rpc({ p_op: op, p_payload: body, p_ts: ts, p_sig: signJob(secret, op, ts, body) });
    if (error) throw new JobError(error.message ?? "Event job failed", error.code);
    return data as T;
  };
}

export type Mailer = {
  send(message: { to: string; subject: string; text: string; html: string; idempotencyKey: string }): Promise<
    { ok: true; id: string | null } | { ok: false; error: string }
  >;
};

export type ClaimedEmail = {
  id: string;
  kind: string;
  dedupe_key: string;
  detail: Record<string, unknown>;
  to: string;
  first_name: string | null;
  occurrence: EventOccurrence;
};

export type DeliveryDeps = {
  job: EventsJob;
  mailer: Mailer | null;
  /** Null in production: send to anyone. Otherwise only these addresses. */
  allowlist: string[] | null;
  siteUrl: string;
  churchName: string;
  testMode: boolean;
};

export type DeliveryReport = { sent: number; failed: number; suppressed: number };

/**
 * Sends queued event emails. The database rechecks each recipient's access
 * when claiming, so nothing is released to someone who lost access. Without
 * a mailer the messages stay queued for a later run.
 */
export async function deliverEventEmails(deps: DeliveryDeps, opts: { occurrence?: string; limit?: number; rounds?: number } = {}): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, failed: 0, suppressed: 0 };
  if (!deps.mailer) return report;
  for (let round = 0; round < (opts.rounds ?? 5); round++) {
    const claimed = await deps.job<ClaimedEmail[]>("email_claim", { limit: opts.limit ?? 20, occurrence: opts.occurrence ?? "" });
    if (!claimed?.length) break;
    for (const m of claimed) {
      if (deps.allowlist && !deps.allowlist.includes(m.to.toLowerCase())) {
        await deps.job("email_result", { id: m.id, status: "suppressed", error: "Not on the test allowlist" });
        report.suppressed++;
        continue;
      }
      const email = renderEventEmail(m, { siteUrl: deps.siteUrl, churchName: deps.churchName, testMode: deps.testMode });
      try {
        const result = await deps.mailer.send({ to: m.to, ...email, idempotencyKey: `event-${m.dedupe_key}`.slice(0, 256) });
        if (result.ok) {
          await deps.job("email_result", { id: m.id, status: "sent", provider_id: result.id });
          report.sent++;
        } else {
          await deps.job("email_result", { id: m.id, status: "failed", error: result.error });
          report.failed++;
        }
      } catch (err) {
        await deps.job("email_result", { id: m.id, status: "failed", error: (err as Error)?.name ?? "error" });
        report.failed++;
      }
    }
    if (claimed.length < (opts.limit ?? 20)) break;
  }
  return report;
}
