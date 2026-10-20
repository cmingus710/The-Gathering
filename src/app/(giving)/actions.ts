"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer, requireSignedIn } from "@/lib/auth/viewer";
import { errorState, formValues, type FormState } from "@/lib/forms";
import { CheckoutError, cancelRecurring, changeRecurringAmount, createCheckout, paymentMethodPortal } from "@/lib/giving/checkout";
import { IngestError } from "@/lib/giving/ingest";
import { parseDollarsToCents } from "@/lib/giving/money";
import { getGivingServer } from "@/lib/giving/server";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Online giving isn't available right now. No payment was made.";
const SAFE_DB = new Set(["22023", "P0001", "P0002"]);

function friendly(err: unknown, fallback: string): string {
  if (err instanceof CheckoutError) return err.message;
  if (err instanceof IngestError && err.code && SAFE_DB.has(err.code)) return err.message;
  console.error("[giving] action failed", { error: (err as Error)?.name, code: (err as { code?: string })?.code });
  return fallback;
}

const giveInput = z.object({
  amount: z.string().max(20),
  frequency: z.enum(["one_time", "weekly", "monthly"]),
  fundId: z.uuid({ message: "Choose a fund." }),
  formToken: z.uuid(),
});

export async function startGiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = giveInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return errorState("Please check the highlighted fields.", { values, fieldErrors: { fundId: parsed.error.issues.some((i) => i.path[0] === "fundId") ? ["Choose a fund."] : undefined } });
  }
  const cents = parseDollarsToCents(parsed.data.amount);
  if (cents === null) return errorState("Please check the amount.", { values, fieldErrors: { amount: ["Enter an amount in dollars, like 25 or 25.50."] } });

  const server = getGivingServer();
  if (!server) return errorState(UNAVAILABLE, { values });
  const viewer = await getViewer();
  const profileId = viewer.state === "signed-in" ? viewer.viewer.id : null;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;

  let url: string;
  try {
    url = await createCheckout(server, { profileId, fundId: parsed.data.fundId, amountCents: cents, frequency: parsed.data.frequency, formToken: parsed.data.formToken, clientIp: ip });
  } catch (err) {
    const message = friendly(err, "We couldn't start checkout. No payment was made. Please try again.");
    return errorState(message, { values, fieldErrors: /amount/i.test(message) ? { amount: [message] } : undefined });
  }
  if (!url.startsWith("https://checkout.stripe.com/")) return errorState(UNAVAILABLE, { values });
  redirect(url);
}

const commitmentInput = z.object({ commitmentId: z.uuid() });

async function ownerContext(formData: FormData) {
  const viewer = await requireSignedIn("/giving");
  const parsed = commitmentInput.safeParse({ commitmentId: formData.get("commitmentId") });
  const server = getGivingServer();
  return { viewer, commitmentId: parsed.success ? parsed.data.commitmentId : null, server };
}

export async function changeAmountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { viewer, commitmentId, server } = await ownerContext(formData);
  if (!commitmentId) return errorState("That recurring gift wasn't found.");
  if (!server) return errorState("Recurring gifts can't be changed right now. Nothing was changed.");
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const token = z.uuid().safeParse(formData.get("formToken"));
  if (cents === null || !token.success) return errorState("Enter an amount in dollars, like 25 or 25.50.", { fieldErrors: { amount: ["Enter an amount in dollars, like 25 or 25.50."] } });

  const supabase = await createClient();
  const { data: config } = (await supabase?.rpc("giving_public_config")) ?? { data: null };
  const limits = config as { min_amount_cents: number; max_amount_cents: number } | null;
  if (!limits || cents < limits.min_amount_cents || cents > limits.max_amount_cents) {
    return errorState("That amount is outside the allowed range.", { fieldErrors: { amount: ["That amount is outside the allowed range."] } });
  }
  try {
    await changeRecurringAmount(server, viewer.id, commitmentId, cents, token.data);
  } catch (err) {
    return errorState(friendly(err, "The amount couldn't be changed. Nothing was changed."));
  }
  revalidatePath("/giving");
  return { status: "success", message: "Updated. Future gifts will use the new amount; past gifts are unchanged." };
}

export async function cancelRecurringAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { viewer, commitmentId, server } = await ownerContext(formData);
  if (!commitmentId) return errorState("That recurring gift wasn't found.");
  if (!server) return errorState("Recurring gifts can't be changed right now. Nothing was changed.");
  try {
    await cancelRecurring(server, viewer.id, commitmentId);
  } catch (err) {
    return errorState(friendly(err, "The gift couldn't be canceled. Please try again."));
  }
  revalidatePath("/giving");
  return { status: "success", message: "Canceled. No further gifts will be charged; gifts you've already given are unaffected." };
}

export async function updatePaymentMethodAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { viewer, commitmentId, server } = await ownerContext(formData);
  if (!commitmentId || !server) return errorState("Payment details can't be updated right now.");
  let url: string;
  try {
    url = await paymentMethodPortal(server, viewer.id, commitmentId);
  } catch (err) {
    return errorState(friendly(err, "Payment details can't be updated right now. Please try again later."));
  }
  if (!url.startsWith("https://billing.stripe.com/")) return errorState("Payment details can't be updated right now.");
  redirect(url);
}

export async function claimGiftAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireSignedIn("/giving");
  const code = String(formData.get("code") ?? "").trim().slice(0, 20);
  const server = getGivingServer();
  if (!server) return errorState("This isn't available right now.");
  try {
    const r = await server.ingest<{ ok: boolean }>("claim_gift", { profile_id: viewer.id, code });
    if (!r.ok) {
      return errorState("We couldn't match that reference to a gift made with your email address.", { values: { code } });
    }
  } catch (err) {
    return errorState(friendly(err, "That couldn't be checked right now. Please try again."), { values: { code } });
  }
  revalidatePath("/giving");
  return { status: "success", message: "That gift has been added to your giving history." };
}
