import "server-only";
import { zonedLocalToUtc } from "@/lib/time";

export type FinancePayment = {
  id: string;
  source: "stripe" | "cash" | "check";
  status: "pending" | "succeeded" | "failed" | "canceled" | "reversed";
  amount_cents: number;
  fund_id: string;
  fund_name: string;
  frequency: "one_time" | "weekly" | "monthly" | null;
  date: string;
  received_on: string | null;
  refunded_cents: number;
  refunds: Array<{ id: string; amount_cents: number; status: string; date: string }>;
  disputed: boolean;
  acknowledged: boolean;
  profile_id: string | null;
  donor: string;
  donor_email: string | null;
  fee_cents: number | null;
  net_cents: number | null;
  fee_status: "pending" | "known" | "unavailable" | "not_applicable";
  check_reference: string | null;
  internal_note: string | null;
  failure_code: string | null;
  replaces_payment_id: string | null;
  replaced_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_invoice_id: string | null;
  claimed_at: string | null;
  created_at: string;
  disputes: Array<{ id: string; amount_cents: number; status: string; reason: string | null; opened_at: string | null; closed_at: string | null }>;
};

export type FinanceDetail = FinancePayment & {
  commitment: { id: string; amount_cents: number; frequency: string; status: string; fund_name: string } | null;
  emails: Array<{ id: string; kind: string; status: string; attempts: number; sent_at: string | null; last_error: string | null }>;
  history: Array<{ action: string; at: string; actor: string | null }>;
};

export type FinanceFund = { id: string; name: string; description: string | null; active: boolean; sort_order: number; gift_count: number };

export const SOURCE_LABEL: Record<string, string> = { stripe: "Online", cash: "Cash", check: "Check" };
export const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  succeeded: "Received",
  failed: "Failed",
  canceled: "Canceled",
  reversed: "Reversed",
};

/** "YYYY-MM-DD" (church time zone) → UTC instant at local midnight. */
export function localDateToUtc(date: string, tz: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? zonedLocalToUtc(`${date}T00:00`, tz) : null;
}

/** Today's date in the church time zone as YYYY-MM-DD. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive local date range → [from, to) UTC instants. Defaults to the current year. */
export function dateRange(params: { from?: unknown; to?: unknown }, tz: string) {
  const today = todayIn(tz);
  const from = typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from) ? params.from : `${today.slice(0, 4)}-01-01`;
  const to = typeof params.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : today;
  return { from, to, fromUtc: localDateToUtc(from, tz)!, toUtc: localDateToUtc(addDays(to, 1), tz)! };
}
