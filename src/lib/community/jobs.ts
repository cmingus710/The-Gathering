import { createHmac } from "node:crypto";
import type { JobRpc, Mailer } from "@/lib/events/jobs";
import { renderCommunityEmail } from "./emails";

/**
 * Client for public.community_job(): digests and retention (tick), and
 * email/push delivery. Signed with the same EVENTS_JOB_SECRET as the events
 * job, over "community.<op>.<timestamp>.<payload>" so a signature for one
 * job can never be replayed against the other.
 */
export type CommunityJobOp = "tick" | "email_claim" | "email_result" | "push_claim" | "push_result";
export type CommunityJob = <T = unknown>(op: CommunityJobOp, payload: Record<string, unknown>) => Promise<T>;

export class CommunityJobError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "CommunityJobError";
  }
}

export function signCommunityJob(secret: string, op: string, ts: number, payload: string): string {
  return createHmac("sha256", secret).update(`community.${op}.${ts}.${payload}`).digest("hex");
}

export function createCommunityJob(secret: string, rpc: JobRpc, now: () => number = () => Date.now()): CommunityJob {
  return async <T>(op: CommunityJobOp, payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    const ts = Math.floor(now() / 1000);
    const { data, error } = await rpc({ p_op: op, p_payload: body, p_ts: ts, p_sig: signCommunityJob(secret, op, ts, body) });
    if (error) throw new CommunityJobError(error.message ?? "Community job failed", error.code);
    return data as T;
  };
}

export type EmailItem = { kind: string; category: string; title: string; url: string };

export type ClaimedCommunityEmail = {
  id: string;
  kind: "immediate" | "digest";
  dedupe_key: string;
  weekly: boolean;
  to: string;
  first_name: string | null;
  items: EmailItem[];
};

export type ClaimedPush = {
  id: string;
  dedupe_key: string;
  body: string;
  url: string;
  subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[];
};

/** Sends one push message; "gone" means the subscription expired (404/410). */
export type PushSender = (
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
) => Promise<"ok" | "gone" | "failed">;

export type CommunityDeliveryDeps = {
  job: CommunityJob;
  mailer: Mailer | null;
  push: PushSender | null;
  allowlist: string[] | null;
  siteUrl: string;
  churchName: string;
  testMode: boolean;
};

export type CommunityDeliveryReport = { sent: number; failed: number; suppressed: number; pushed: number; pushFailed: number };

/**
 * Sends queued community email. The database rechecks access while claiming
 * and returns only generic, already-authorized items (never message text).
 * Without a mailer, messages stay queued.
 */
export async function deliverCommunityEmails(deps: CommunityDeliveryDeps, opts: { limit?: number; rounds?: number } = {}) {
  const report: CommunityDeliveryReport = { sent: 0, failed: 0, suppressed: 0, pushed: 0, pushFailed: 0 };
  if (deps.mailer) {
    for (let round = 0; round < (opts.rounds ?? 5); round++) {
      const claimed = await deps.job<ClaimedCommunityEmail[]>("email_claim", { limit: opts.limit ?? 20 });
      if (!claimed?.length) break;
      for (const m of claimed) {
        if (!m.to || (deps.allowlist && !deps.allowlist.includes(m.to.toLowerCase()))) {
          await deps.job("email_result", { id: m.id, status: "suppressed", error: "Not on the test allowlist" });
          report.suppressed++;
          continue;
        }
        const email = renderCommunityEmail(m, { siteUrl: deps.siteUrl, churchName: deps.churchName, testMode: deps.testMode });
        try {
          const result = await deps.mailer.send({ to: m.to, ...email, idempotencyKey: `community-${m.dedupe_key}`.slice(0, 256) });
          await deps.job("email_result", result.ok ? { id: m.id, status: "sent", provider_id: result.id } : { id: m.id, status: "failed", error: result.error });
          if (result.ok) report.sent++;
          else report.failed++;
        } catch (err) {
          await deps.job("email_result", { id: m.id, status: "failed", error: (err as Error)?.name ?? "error" });
          report.failed++;
        }
      }
      if (claimed.length < (opts.limit ?? 20)) break;
    }
  }
  if (deps.push) {
    for (let round = 0; round < (opts.rounds ?? 5); round++) {
      const claimed = await deps.job<ClaimedPush[]>("push_claim", { limit: opts.limit ?? 20 });
      if (!claimed?.length) break;
      for (const p of claimed) {
        const payload = JSON.stringify({ title: deps.churchName, body: p.body, url: p.url, tag: p.dedupe_key.split(":").slice(0, 2).join(":") });
        const ok: string[] = [];
        const gone: string[] = [];
        const failed: string[] = [];
        for (const s of p.subscriptions) {
          const result = await deps.push(s, payload).catch(() => "failed" as const);
          (result === "ok" ? ok : result === "gone" ? gone : failed).push(s.id);
        }
        const status = ok.length > 0 || failed.length === 0 ? "sent" : "failed";
        await deps.job("push_result", { id: p.id, status, ok, gone, failed });
        if (status === "sent") report.pushed++;
        else report.pushFailed++;
      }
      if (claimed.length < (opts.limit ?? 20)) break;
    }
  }
  return report;
}
