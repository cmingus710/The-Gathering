import { timingSafeEqual } from "node:crypto";
import { deliverCommunityEmails } from "@/lib/community/jobs";
import { getCommunityDeliveryDeps } from "@/lib/community/server";
import { deliverEventEmails, verifyJobSignature } from "@/lib/events/jobs";
import { getDeliveryDeps, getEventsConfig } from "@/lib/events/server";
import { getChurchSettings } from "@/lib/settings/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function bearerOk(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled work: queue due reminders, then send queued event email; then
 * the community tick (digests, invitation expiry, retention) and queued
 * community email and push (Phase 5 shares this scheduler and secret).
 * Called every few minutes by the database scheduler (pg_cron + pg_net,
 * signed with EVENTS_JOB_SECRET over "tick.<ts>."). A Vercel cron (GET with
 * CRON_SECRET) can drive it too after a production release. Safe to call
 * from several places: reminders are deduplicated and each message is
 * claimed by exactly one sender.
 */
async function run() {
  const { settings } = await getChurchSettings();
  const deps = getDeliveryDeps(settings.churchName);
  if (!deps) return json({ error: "not_configured" }, 503);
  try {
    const tick = await deps.job<{ queued?: number; pending?: number; skipped?: boolean }>("tick", {});
    const sent = await deliverEventEmails(deps, { rounds: 5, limit: 20 });
    const community = getCommunityDeliveryDeps(settings.churchName);
    let communityResult: unknown = null;
    if (community) {
      try {
        const communityTick = await community.job("tick", {});
        const delivered = await deliverCommunityEmails(community, { rounds: 5, limit: 20 });
        communityResult = { tick: communityTick, delivered };
      } catch (err) {
        console.error("[community] job failed", { error: (err as Error)?.name });
        communityResult = { error: "failed" };
      }
    }
    return json({ tick, sent, community: communityResult });
  } catch (err) {
    console.error("[events] job failed", { error: (err as Error)?.name });
    return json({ error: "failed" }, 500);
  }
}

export async function POST(request: Request) {
  const { jobSecret } = getEventsConfig();
  if (!jobSecret) return json({ error: "not_configured" }, 503);
  const ok = verifyJobSignature(jobSecret, "tick", request.headers.get("x-events-ts"), request.headers.get("x-events-signature"));
  if (!ok) return json({ error: "unauthorized" }, 401);
  return run();
}

export async function GET(request: Request) {
  if (!bearerOk(request.headers.get("authorization"), process.env.CRON_SECRET)) return json({ error: "unauthorized" }, 401);
  return run();
}
