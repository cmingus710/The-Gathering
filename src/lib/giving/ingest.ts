import { createHmac } from "node:crypto";

/**
 * Client for public.giving_ingest(): the only write path for provider-
 * confirmed giving state. Each call is signed with GIVING_INGEST_SECRET
 * (shared with the database) over "<op>.<timestamp>.<payload>", and the
 * database refuses unsigned, mis-signed, or stale (> 5 min) calls.
 */
export type IngestOp =
  | "rate_limit"
  | "checkout_prepare"
  | "checkout_attach"
  | "checkout_status"
  | "customer_link"
  | "fund_product"
  | "event_begin"
  | "event_finish"
  | "sync_checkout"
  | "sync_payment"
  | "sync_subscription"
  | "sync_invoice"
  | "sync_charge"
  | "sync_refund"
  | "sync_dispute"
  | "email_claim"
  | "email_result"
  | "claim_gift"
  | "owner_commitment"
  | "owner_customer"
  | "pending_fees";

export type Ingest = <T = Record<string, unknown>>(op: IngestOp, payload: Record<string, unknown>) => Promise<T>;

/** Error raised by the database with a member-safe message (SQLSTATE in `code`). */
export class IngestError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export function signIngest(secret: string, op: string, ts: number, payload: string): string {
  return createHmac("sha256", secret).update(`${op}.${ts}.${payload}`).digest("hex");
}

export type RpcCaller = (args: { p_op: string; p_payload: string; p_ts: number; p_sig: string }) => Promise<{
  data: unknown;
  error: { message?: string; code?: string } | null;
}>;

export function createIngest(secret: string, rpc: RpcCaller, now: () => number = () => Date.now()): Ingest {
  return async <T>(op: IngestOp, payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    const ts = Math.floor(now() / 1000);
    const { data, error } = await rpc({ p_op: op, p_payload: body, p_ts: ts, p_sig: signIngest(secret, op, ts, body) });
    if (error) throw new IngestError(error.message ?? "Giving request failed", error.code);
    if (data === null || data === undefined) throw new IngestError(`Giving operation ${op} returned nothing`, undefined);
    return data as T;
  };
}
