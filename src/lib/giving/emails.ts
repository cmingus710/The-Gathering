import { escape, layout } from "@/lib/email/templates";
import { FREQUENCY_LABEL, formatCents, type Frequency } from "./money";

/** One claimed outbox row (see giving.op_email_claim). */
export type EmailJob = {
  id: string;
  kind: "acknowledgment" | "payment_failed" | "cancellation" | "refund";
  dedupe_key: string;
  to: string;
  livemode: boolean;
  recovery_url: string | null;
  first_name: string | null;
  is_guest: boolean;
  amount_cents: number | null;
  payment_amount_cents: number | null;
  fund_name: string | null;
  frequency: Frequency | null;
  received_at: string | null;
  next_payment_at: string | null;
  claim_code: string | null;
  acknowledgment_message: string | null;
  church_name: string | null;
  timezone: string | null;
};

function date(iso: string | null, tz: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: tz ?? "America/Chicago" }).format(new Date(iso));
  } catch {
    return null;
  }
}

const button = (href: string, label: string) =>
  `<p><a href="${escape(href)}" style="display:inline-block;background:#80642F;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escape(label)}</a></p>`;

/**
 * Giving emails. Wording is deliberately neutral: no tax-deductibility
 * claims (statements carry church-approved wording only once configured).
 * Test-mode emails are clearly marked in the subject and body.
 */
export function renderGivingEmail(job: EmailJob, siteUrl: string): { subject: string; text: string; html: string } {
  const church = job.church_name || "The Gathering";
  const hello = job.first_name ? `Hello ${job.first_name},` : "Hello,";
  const amount = job.amount_cents != null ? formatCents(job.amount_cents) : "your gift";
  const fund = job.fund_name ?? "the church";
  const freq = job.frequency && job.frequency !== "one_time" ? FREQUENCY_LABEL[job.frequency].toLowerCase() : null;
  const givingUrl = `${siteUrl}/giving`;

  let subject: string;
  const lines: string[] = [];
  const html: string[] = [];
  const add = (text: string, markup?: string) => {
    lines.push(text);
    html.push(markup ?? `<p>${escape(text)}</p>`);
  };

  switch (job.kind) {
    case "acknowledgment": {
      subject = "Thank you for your gift";
      add(hello);
      add(job.acknowledgment_message || "Thank you for your generous gift.");
      const details = [
        `Amount: ${amount}`,
        `Fund: ${fund}`,
        date(job.received_at, job.timezone) ? `Date: ${date(job.received_at, job.timezone)}` : null,
        freq ? `Schedule: ${freq}` : null,
      ].filter(Boolean) as string[];
      add(details.join("\n"), `<p>${details.map(escape).join("<br>")}</p>`);
      if (job.is_guest && job.claim_code) {
        add(
          `Gift reference: ${job.claim_code}. If you create an account with this email address later, you can use this reference to add this gift to your giving history.`,
          `<p>Gift reference: <strong>${escape(job.claim_code)}</strong><br>If you create an account with this email address later, you can use this reference to add this gift to your giving history.</p>`,
        );
      } else if (!job.is_guest) {
        add(`See your giving history: ${givingUrl}`, button(givingUrl, "View your giving"));
      }
      add("This email confirms that we received your gift. It is not an annual giving statement.");
      break;
    }
    case "payment_failed": {
      subject = "We couldn't process your recurring gift";
      add(hello);
      add(`We weren't able to process your ${freq ?? "recurring"} gift of ${amount} to ${fund}. No money was taken for this attempt.`);
      if (job.is_guest && job.recovery_url) {
        add(`You can complete this payment or use a different card here: ${job.recovery_url}`, button(job.recovery_url, "Complete payment"));
      } else {
        add(`You can update your payment method or cancel the gift from your giving page: ${givingUrl}`, button(givingUrl, "Update payment method"));
      }
      add("If you no longer wish to give on this schedule, you don't need to do anything else; you can cancel at any time.");
      break;
    }
    case "cancellation": {
      subject = "Your recurring gift has been canceled";
      add(hello);
      add(`Your ${freq ?? "recurring"} gift of ${amount} to ${fund} has been canceled. No further payments will be charged.`);
      add("Gifts you have already given are not affected. Thank you for your generosity.");
      break;
    }
    case "refund": {
      subject = "Your gift has been refunded";
      add(hello);
      const of = job.payment_amount_cents != null ? ` of your ${formatCents(job.payment_amount_cents)} gift` : "";
      add(`We've refunded ${amount}${of} to ${fund}. It may take several business days to appear on your statement.`);
      if (!job.is_guest) add(`Your giving history: ${givingUrl}`, button(givingUrl, "View your giving"));
      break;
    }
  }

  if (!job.livemode) {
    subject = `[TEST] ${subject}`;
    lines.unshift("TEST EMAIL: sent from a test environment. No real money was moved.\n");
    html.unshift(
      `<p style="background:#FFF4D6;border:1px solid #AD8C53;border-radius:8px;padding:8px 12px;font-weight:bold">TEST EMAIL: sent from a test environment. No real money was moved.</p>`,
    );
  }
  return { subject, text: `${lines.join("\n\n")}\n\n${church}`, html: layout(church, html.join("\n")) };
}
