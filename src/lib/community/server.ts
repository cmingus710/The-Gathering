import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";
import { getEventsConfig, getMailer } from "@/lib/events/server";
import { getSiteUrl } from "@/lib/site-url";
import { createCommunityJob, deliverCommunityEmails, type CommunityDeliveryDeps, type CommunityJob, type PushSender } from "./jobs";

type Env = Record<string, string | undefined>;

/**
 * Web push needs a VAPID key pair. The public key is safe to expose (the
 * browser needs it to subscribe); the private key stays on the server.
 * Without all three values, push is simply off and in-app/email still work.
 */
export function getPushConfig(env: Env = process.env) {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  const ok = /^[A-Za-z0-9_-]{80,100}$/.test(publicKey) && /^[A-Za-z0-9_-]{40,50}$/.test(privateKey) && /^(mailto:|https:\/\/)/.test(subject);
  return ok ? { publicKey, privateKey, subject } : null;
}

export function getCommunityJob(): CommunityJob | null {
  const { jobSecret } = getEventsConfig();
  const supabase = getSupabasePublicConfig();
  if (!jobSecret || !supabase) return null;
  const db = createSupabaseClient(supabase.url, supabase.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return createCommunityJob(jobSecret, async (args) => {
    const { data, error } = await db.rpc("community_job", args);
    return { data, error };
  });
}

function getPushSender(): PushSender | null {
  const config = getPushConfig();
  if (!config) return null;
  return async (subscription, payload) => {
    const webpush = (await import("web-push")).default;
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: 60 * 60 * 24, urgency: "normal" },
      );
      return "ok";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? "gone" : "failed";
    }
  };
}

/**
 * Delivery uses the same secret, allowlist, and mail settings as events:
 * outside production only allowlisted addresses receive email.
 */
export function getCommunityDeliveryDeps(churchName: string): CommunityDeliveryDeps | null {
  const job = getCommunityJob();
  if (!job) return null;
  const config = getEventsConfig();
  return {
    job,
    mailer: getMailer(),
    push: getPushSender(),
    allowlist: config.allowlist,
    siteUrl: getSiteUrl(),
    churchName,
    testMode: !config.production,
  };
}

/** Sends due community email/push now (best effort; the scheduler retries). */
export async function deliverCommunityNow(churchName: string) {
  const deps = getCommunityDeliveryDeps(churchName);
  if (!deps) return;
  try {
    await deliverCommunityEmails(deps, { rounds: 1, limit: 10 });
  } catch (err) {
    console.error("[community] immediate delivery failed", { error: (err as Error)?.name });
  }
}
