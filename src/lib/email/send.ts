import "server-only";
import { Resend } from "resend";
import { getEmailConfig } from "@/lib/env";

export type EmailResult = { sent: true } | { sent: false; reason: "not_configured" | "failed" };

/**
 * Sends a transactional email through Resend. Authentication emails
 * (verification, password reset) are sent by Supabase Auth using Resend SMTP;
 * this helper covers app notifications such as membership approval.
 * Failures are reported, never hidden, and never block the admin action.
 */
export async function sendEmail(message: { to: string; subject: string; text: string; html: string }): Promise<EmailResult> {
  const config = getEmailConfig();
  if (!config) return { sent: false, reason: "not_configured" };
  try {
    const resend = new Resend(config.apiKey);
    const { error } = await resend.emails.send({ from: config.from, ...message });
    if (error) {
      console.error("[email] Resend rejected a message", { name: error.name });
      return { sent: false, reason: "failed" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] Resend request failed", { name: (err as Error)?.name });
    return { sent: false, reason: "failed" };
  }
}
