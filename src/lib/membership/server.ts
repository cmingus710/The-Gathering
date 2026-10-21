import "server-only";
import { getCommunityJob } from "@/lib/community/server";
import { getEventsConfig, getMailer } from "@/lib/events/server";
import { getChurchSettings } from "@/lib/settings/queries";
import { getSiteUrl } from "@/lib/site-url";
import { deliverApprovalAlerts, type ApprovalAlertDeps } from "./alerts";

/**
 * Same secret, sender, and allowlist as community email. Outside production
 * only alerts for registrations made outside production are claimed, and
 * only allowlisted addresses receive them.
 */
export function getApprovalAlertDeps(settings: { churchName: string; timezone: string }): ApprovalAlertDeps | null {
  const job = getCommunityJob();
  if (!job) return null;
  const config = getEventsConfig();
  return {
    job,
    mailer: getMailer(),
    allowlist: config.allowlist,
    siteUrl: getSiteUrl(),
    churchName: settings.churchName,
    timeZone: settings.timezone,
    testMode: !config.production,
  };
}

/**
 * Sends due approval alerts now, after a verification link was used (best
 * effort; the scheduler retries). Never throws, so verification never fails
 * because of an alert.
 */
export async function deliverApprovalAlertsNow() {
  try {
    const { settings } = await getChurchSettings();
    const deps = getApprovalAlertDeps(settings);
    if (!deps) return;
    await deliverApprovalAlerts(deps, { rounds: 1, limit: 20 });
  } catch (err) {
    console.error("[membership] immediate approval alert delivery failed", { error: (err as Error)?.name });
  }
}
