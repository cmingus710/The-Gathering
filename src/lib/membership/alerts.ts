import type { CommunityJob } from "@/lib/community/jobs";
import { escape, layout } from "@/lib/email/templates";
import type { Mailer } from "@/lib/events/jobs";
import { formatDateTime } from "@/lib/time";

/**
 * Membership approval alerts: one email per configured recipient when a new
 * account first becomes eligible for approval (see
 * supabase/migrations/20261101000300_membership_approval_alerts.sql for when
 * an alert is queued). Delivered through the signed community job, like
 * community email, with one Resend message and idempotency key per recipient.
 */
export const APPROVAL_ALERT_SUBJECT = "New member awaiting approval — The Gathering";

/** Resend error names that won't succeed on a retry. Everything else is retried. */
const PERMANENT_ERRORS = new Set(["validation_error", "invalid_parameter", "missing_required_field", "invalid_from_address", "invalid_idempotent_request"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClaimedApprovalAlert = {
  id: string;
  to: string;
  profile_id: string;
  name: string;
  email: string;
  eligible_at: string;
};

/**
 * Recorded on the account at sign-up so a registration made on a preview
 * (which shares the production database) is never announced to production
 * recipients. The database treats a missing value as production.
 */
export function registrationEnvironment(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV === "production") return "production";
  return env.VERCEL_ENV === "preview" ? "preview" : "development";
}

export function renderApprovalAlert(
  a: Pick<ClaimedApprovalAlert, "profile_id" | "name" | "email" | "eligible_at">,
  opts: { siteUrl: string; churchName: string; timeZone: string; testMode: boolean },
) {
  if (!UUID.test(a.profile_id)) throw new Error("Invalid member id");
  // The member record is behind sign-in and members.view; it never approves anything by itself.
  const url = `${opts.siteUrl}/admin/members/${a.profile_id}`;
  const name = a.name.trim() || "Name not provided";
  const requested = `${formatDateTime(a.eligible_at, opts.timeZone)} (${opts.timeZone})`;
  const subject = `${opts.testMode ? "[TEST] " : ""}${APPROVAL_ALERT_SUBJECT}`;
  const text = [
    opts.testMode ? "[TEST MESSAGE: sent from a test environment]\n" : "",
    "A new account has confirmed its email address and is waiting for membership approval.",
    "",
    `Name: ${name}`,
    `Email: ${a.email}`,
    `Requested: ${requested}`,
    "",
    `Review membership request (sign-in required): ${url}`,
    "",
    "You receive this because you're listed for membership approval notifications in Church settings.",
  ]
    .filter((line, i) => i > 0 || line)
    .join("\n");
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#716B61;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0">${escape(value)}</td></tr>`;
  const html = layout(
    opts.churchName,
    `${opts.testMode ? `<p style="background:#FFF4D6;border:1px solid #AD8C53;border-radius:8px;padding:8px 12px;font-size:13px"><strong>Test message</strong>: sent from a test environment.</p>` : ""}
<p>A new account has confirmed its email address and is waiting for membership approval.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;margin:8px 0 16px">${row("Name", name)}${row("Email", a.email)}${row("Requested", requested)}</table>
<p><a href="${escape(url)}" style="display:inline-block;background:#80642F;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Review membership request</a></p>
<p style="font-size:13px;color:#716B61">You&#39;ll be asked to sign in. You receive this because you&#39;re listed for membership approval notifications in Church settings.</p>`,
  );
  return { subject, text, html };
}

export type ApprovalAlertDeps = {
  job: CommunityJob;
  mailer: Mailer | null;
  /** Outside production: the only addresses that may receive email. */
  allowlist: string[] | null;
  siteUrl: string;
  churchName: string;
  timeZone: string;
  /** Outside production: claim only alerts for registrations made outside production. */
  testMode: boolean;
  timeoutMs?: number;
};

export type ApprovalAlertReport = { sent: number; failed: number; suppressed: number };

class SendTimeout extends Error {
  name = "TimeoutError";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SendTimeout("Email provider timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Sends queued approval alerts. Each claimed row is one recipient; its
 * result is recorded before the next is sent, so a retry only ever covers
 * recipients that weren't sent. A timeout counts as a failure and is
 * retried with the same idempotency key, so Resend won't deliver it twice.
 * Without a mailer, alerts stay queued.
 */
export async function deliverApprovalAlerts(deps: ApprovalAlertDeps, opts: { limit?: number; rounds?: number } = {}): Promise<ApprovalAlertReport> {
  const report: ApprovalAlertReport = { sent: 0, failed: 0, suppressed: 0 };
  if (!deps.mailer) return report;
  const limit = opts.limit ?? 20;
  for (let round = 0; round < (opts.rounds ?? 5); round++) {
    const claimed = await deps.job<ClaimedApprovalAlert[]>("membership_alert_claim", { limit, test: deps.testMode });
    if (!claimed?.length) break;
    for (const a of claimed) {
      if (!a.to || (deps.allowlist && !deps.allowlist.includes(a.to.toLowerCase()))) {
        await deps.job("membership_alert_result", { id: a.id, status: "suppressed", error: "Not on the test allowlist" });
        report.suppressed++;
        continue;
      }
      try {
        const email = renderApprovalAlert(a, deps);
        const result = await withTimeout(deps.mailer.send({ to: a.to, ...email, idempotencyKey: `membership-alert-${a.id}` }), deps.timeoutMs ?? 15_000);
        if (result.ok) {
          await deps.job("membership_alert_result", { id: a.id, status: "sent", provider_id: result.id });
          report.sent++;
        } else {
          await deps.job("membership_alert_result", { id: a.id, status: "failed", error: result.error, retry: !PERMANENT_ERRORS.has(result.error) });
          report.failed++;
        }
      } catch (err) {
        await deps.job("membership_alert_result", { id: a.id, status: "failed", error: (err as Error)?.name ?? "error" });
        report.failed++;
      }
    }
    if (claimed.length < limit) break;
  }
  return report;
}
