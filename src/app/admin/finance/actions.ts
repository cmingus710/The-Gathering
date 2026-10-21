"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { CheckoutError, issueRefund, reconcile } from "@/lib/giving/checkout";
import { localDateToUtc, addDays } from "@/lib/giving/finance";
import { manualInput } from "@/lib/giving/manual";
import { formatCents, parseDollarsToCents } from "@/lib/giving/money";
import { deliverEmails } from "@/lib/giving/processor";
import { getGivingServer } from "@/lib/giving/server";
import { getChurchSettings } from "@/lib/settings/queries";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Finance actions. Each one checks the specific finance capability here and
 * the database checks it again; nothing here logs amounts or donor details.
 */
const UNAVAILABLE = "The finance service is unavailable. Nothing was changed.";
const optionalUuid = z.union([z.uuid(), z.literal("")]).transform((v) => v || null);

function manualArgs(formData: FormData) {
  const values = formValues(formData);
  const parsed = manualInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return { error: errorState("Please correct the highlighted fields.", { values, fieldErrors }) };
  }
  const cents = parseDollarsToCents(parsed.data.amount);
  if (cents === null) return { error: errorState("Please correct the amount.", { values, fieldErrors: { amount: ["Enter an amount in dollars, like 25 or 25.50."] } }) };
  const d = parsed.data;
  return {
    values,
    args: {
      p_token: d.formToken,
      p_profile: d.donorProfileId,
      p_donor_name: d.donorName || null,
      p_received_on: d.receivedOn,
      p_amount_cents: cents,
      p_fund: d.fundId,
      p_method: d.method,
      p_check_reference: d.method === "check" ? d.checkReference || null : null,
      p_note: d.note || null,
    },
  };
}

export async function recordManualAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeRecord, "/admin/finance/manual");
  const m = manualArgs(formData);
  if ("error" in m) return m.error!;
  const campaign = optionalUuid.safeParse(formData.get("campaignId") ?? "");
  if (!campaign.success) return errorState("Choose a campaign from the list.", { values: m.values, fieldErrors: { campaignId: ["Choose a campaign from the list."] } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values: m.values });
  // A campaign gift goes to the campaign's fund (set in the database), so p_fund isn't sent.
  const { p_token, p_profile, p_donor_name, p_received_on, p_amount_cents, p_method, p_check_reference, p_note } = m.args;
  const { data, error } = campaign.data
    ? await supabase.rpc("finance_record_campaign_gift", {
        p_token, p_campaign: campaign.data, p_profile, p_donor_name, p_received_on, p_amount_cents, p_method, p_check_reference, p_note,
      })
    : await supabase.rpc("finance_record_manual", m.args);
  if (error) return errorState(dbErrorMessage(error), { values: m.values });
  const r = data as { payment_id: string; duplicate: boolean };
  revalidatePath("/admin/finance", "layout");
  return {
    status: "success",
    message: r.duplicate ? "This form was already submitted; the gift was recorded once." : `Recorded a ${m.args.p_method} gift of ${formatCents(m.args.p_amount_cents)}.`,
    values: { paymentId: r.payment_id },
  };
}

export async function correctManualAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeRecord, "/admin/finance/contributions");
  const id = z.uuid().safeParse(formData.get("paymentId"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 250);
  const m = manualArgs(formData);
  if ("error" in m) return m.error!;
  if (!id.success) return errorState("That gift wasn't found.");
  if (!reason) return errorState("Enter a reason for the correction.", { values: m.values, fieldErrors: { reason: ["Enter a reason."] } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values: m.values });
  const { data, error } = await supabase.rpc("finance_correct_manual", { p_id: id.data, ...m.args, p_reason: reason });
  if (error) return errorState(dbErrorMessage(error), { values: m.values });
  revalidatePath("/admin/finance", "layout");
  return { status: "success", message: "Corrected. The original entry is kept as reversed and linked to the correction.", values: { paymentId: (data as { payment_id: string }).payment_id } };
}

export async function reverseManualAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeRecord, "/admin/finance/contributions");
  const id = z.uuid().safeParse(formData.get("paymentId"));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!id.success) return errorState("That gift wasn't found.");
  if (!reason) return errorState("Enter a reason for the reversal.", { fieldErrors: { reason: ["Enter a reason."] } });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("finance_reverse_payment", { p_id: id.data, p_reason: reason });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin/finance", "layout");
  return { status: "success", message: "Reversed. The entry stays in history but no longer counts as received." };
}

export async function associateDonorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeRecord, "/admin/finance/contributions");
  const id = z.uuid().safeParse(formData.get("paymentId"));
  const profile = optionalUuid.safeParse(formData.get("profileId") ?? "");
  if (!id.success || !profile.success) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("finance_associate_donor", { p_payment: id.data, p_profile: profile.data });
  if (error) return errorState(dbErrorMessage(error));
  revalidatePath("/admin/finance", "layout");
  return { status: "success", message: profile.data ? "Donor linked. The gift now appears in their giving history." : "Donor link removed." };
}

export async function refundAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireCapability(CAPABILITIES.financeRefund, "/admin/finance/contributions");
  const id = z.uuid().safeParse(formData.get("paymentId"));
  const token = z.uuid().safeParse(formData.get("formToken"));
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (!id.success || !token.success) return errorState("That request wasn't valid.");
  if (cents === null) return errorState("Enter the refund amount in dollars.", { fieldErrors: { amount: ["Enter the refund amount in dollars."] } });
  const supabase = await createClient();
  const server = getGivingServer();
  if (!supabase || !server) return errorState(UNAVAILABLE);
  // Permission and refundable balance are checked in the database first (audited).
  const { data, error } = await supabase.rpc("finance_refund_check", { p_payment: id.data, p_amount_cents: cents });
  if (error) return errorState(dbErrorMessage(error), { fieldErrors: { amount: [dbErrorMessage(error)] } });
  try {
    const status = await issueRefund(server, data as { payment_intent_id: string | null; charge_id: string | null }, cents, token.data, id.data, viewer.id);
    revalidatePath("/admin/finance", "layout");
    return { status: "success", message: status === "succeeded" ? `Refunded ${formatCents(cents)}.` : `Refund of ${formatCents(cents)} submitted (${status}). It will update when Stripe confirms.` };
  } catch (err) {
    if (err instanceof CheckoutError) return errorState(err.message);
    console.error("[giving] refund failed", { error: (err as { type?: string })?.type ?? (err as Error)?.name });
    return errorState("Stripe didn't accept the refund. Nothing was refunded. Check the payment in Stripe and try again.");
  }
}

const fundInput = z.object({
  id: optionalUuid,
  name: z.string().trim().min(1, "Enter a fund name.").max(80, "Use 80 characters or fewer."),
  description: z.string().trim().max(300, "Use 300 characters or fewer."),
  sortOrder: z.coerce.number().int().min(0).max(10000).catch(0),
});

export async function saveFundAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeManage, "/admin/finance/funds");
  const values = formValues(formData);
  const parsed = fundInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return errorState(parsed.error.issues[0].message, { values, fieldErrors: { name: [parsed.error.issues[0].message] } });
  const op = formData.get("op");
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("finance_fund_save", {
    p_id: parsed.data.id,
    p_name: parsed.data.name,
    p_description: parsed.data.description || null,
    p_active: op === "archive" ? false : op === "restore" ? true : null,
    p_sort: parsed.data.sortOrder,
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath("/admin/finance", "layout");
  revalidatePath("/give");
  return {
    status: "success",
    message: op === "archive" ? "Archived. Donors can no longer choose it; past gifts keep it." : op === "restore" ? "Restored." : parsed.data.id ? "Fund saved. Past gifts keep the name they were given under." : "Fund added.",
  };
}

const settingsInput = z.object({
  minAmount: z.string(),
  maxAmount: z.string(),
  acknowledgment: z.string().trim().min(1, "Enter acknowledgment wording.").max(1000),
  orgName: z.string().trim().max(120),
  orgAddress: z.string().trim().max(300),
  taxId: z.string().trim().max(40),
  wording: z.string().trim().max(2000),
});

export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeManage, "/admin/finance/settings");
  const values = formValues(formData);
  const parsed = settingsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return errorState("Please correct the highlighted fields.", { values, fieldErrors });
  }
  const min = parseDollarsToCents(parsed.data.minAmount);
  const max = parseDollarsToCents(parsed.data.maxAmount);
  if (min === null || max === null) return errorState("Enter the amounts in dollars.", { values });
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });
  const { error } = await supabase.rpc("finance_settings_save", {
    p_min_cents: min,
    p_max_cents: max,
    p_ack: parsed.data.acknowledgment,
    p_org_name: parsed.data.orgName,
    p_org_address: parsed.data.orgAddress,
    p_tax_id: parsed.data.taxId,
    p_wording: parsed.data.wording,
    p_approved: formData.get("approved") === "on",
  });
  if (error) return errorState(dbErrorMessage(error), { values });
  revalidatePath("/admin/finance", "layout");
  revalidatePath("/give");
  return { status: "success", message: "Giving settings saved." };
}

export async function retryEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeManage, "/admin/finance/operations");
  const id = z.uuid().safeParse(formData.get("emailId"));
  if (!id.success) return errorState("That request wasn't valid.");
  const supabase = await createClient();
  const server = getGivingServer();
  if (!supabase || !server) return errorState(UNAVAILABLE);
  const { error } = await supabase.rpc("finance_email_retry", { p_id: id.data });
  if (error) return errorState(dbErrorMessage(error));
  const r = await deliverEmails(server, { id: id.data }).catch(() => null);
  revalidatePath("/admin/finance", "layout");
  if (!r) return errorState("Queued for retry, but sending failed. It will be retried again.");
  return { status: "success", message: r.sent ? "Sent." : r.suppressed ? "Not sent: this address isn't on the test-email allowlist." : "Still failing. It will be retried." };
}

export async function reconcileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireCapability(CAPABILITIES.financeManage, "/admin/finance/operations");
  const values = formValues(formData);
  const server = getGivingServer();
  if (!server) return errorState(UNAVAILABLE, { values });
  const { settings } = await getChurchSettings();
  const from = localDateToUtc(String(formData.get("from") ?? ""), settings.timezone);
  const toDate = String(formData.get("to") ?? "");
  const to = localDateToUtc(/^\d{4}-\d{2}-\d{2}$/.test(toDate) ? addDays(toDate, 1) : "", settings.timezone);
  if (!from || !to || to <= from) return errorState("Choose a valid date range.", { values });
  if (to.getTime() - from.getTime() > 93 * 86400_000) return errorState("Reconcile up to about three months at a time.", { values });
  try {
    const r = await reconcile(server, from, to);
    revalidatePath("/admin/finance", "layout");
    return {
      status: "success",
      message:
        `Checked ${r.sessions} checkouts, ${r.invoices} recurring invoices, ${r.refunds} refunds, ${r.disputes} disputes, and ${r.fees} pending fees. ` +
        `${r.created} missing record(s) added, ${r.changed} updated${r.errors ? `, ${r.errors} could not be read` : ""}. ` +
        `Emails: ${r.emails.sent} sent, ${r.emails.suppressed} suppressed, ${r.emails.failed} failed.`,
      values,
    };
  } catch (err) {
    console.error("[giving] reconcile failed", { error: (err as { type?: string })?.type ?? (err as Error)?.name });
    return errorState("Stripe couldn't be reached. Nothing was changed. Try again shortly.", { values });
  }
}
