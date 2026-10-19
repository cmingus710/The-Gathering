import type { Frequency } from "@/lib/giving/money";

export type MyPayment = {
  id: string;
  source: "stripe" | "cash" | "check";
  status: "succeeded" | "pending" | "failed" | "canceled" | "reversed";
  amount_cents: number;
  fund_name: string;
  frequency: Frequency | null;
  date: string;
  refunded_cents: number;
  refunds: Array<{ id: string; amount_cents: number; status: string; date: string }>;
  disputed: boolean;
  acknowledged: boolean;
  acknowledgment_message?: string;
};

export type MyCommitment = {
  id: string;
  amount_cents: number;
  fund_name: string;
  frequency: Frequency;
  status: string;
  next_payment_at: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
};

export type MyGiving = { payments: MyPayment[]; commitments: MyCommitment[]; years: number[]; statement_ready: boolean };
