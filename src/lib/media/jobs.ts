import { createHmac } from "node:crypto";
import type { JobRpc } from "@/lib/events/jobs";

/**
 * Client for public.media_job(): scheduled refreshes of external podcast
 * feeds. Signed with the same EVENTS_JOB_SECRET as the events and community
 * jobs, over "media.<op>.<timestamp>.<payload>", so a signature for one job
 * can never be replayed against another.
 */
export type MediaJobOp = "feeds_claim" | "feed_result";
export type MediaJob = <T = unknown>(op: MediaJobOp, payload: Record<string, unknown>) => Promise<T>;

export class MediaJobError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "MediaJobError";
  }
}

export function signMediaJob(secret: string, op: string, ts: number, payload: string): string {
  return createHmac("sha256", secret).update(`media.${op}.${ts}.${payload}`).digest("hex");
}

export function createMediaJob(secret: string, rpc: JobRpc, now: () => number = () => Date.now()): MediaJob {
  return async <T>(op: MediaJobOp, payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    const ts = Math.floor(now() / 1000);
    const { data, error } = await rpc({ p_op: op, p_payload: body, p_ts: ts, p_sig: signMediaJob(secret, op, ts, body) });
    if (error) throw new MediaJobError(error.message ?? "Media job failed", error.code);
    return data as T;
  };
}
