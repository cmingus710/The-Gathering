import "server-only";
import { createHmac } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";
import { getEventsConfig } from "@/lib/events/server";
import { createMediaJob, type MediaJob } from "./jobs";

/** A session-less client (visitor rights only) for public endpoints and the signed job. */
export function getAnonClient(): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createSupabaseClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Signed entry point for scheduled feed refreshes (same secret as the events job). */
export function getMediaJob(): MediaJob | null {
  const { jobSecret } = getEventsConfig();
  const db = getAnonClient();
  if (!jobSecret || !db) return null;
  return createMediaJob(jobSecret, async (args) => {
    const { data, error } = await db.rpc("media_job", args);
    return { data, error };
  });
}

/**
 * A keyed hash of the client address for best-effort public rate limits.
 * Never the address itself, and not reversible without the server secret.
 * Without a secret, public endpoints are not rate limited (cached instead).
 */
export function clientKey(request: Request, purpose: string): string | null {
  const secret = process.env.MEDIA_RATE_SECRET ?? process.env.EVENTS_JOB_SECRET;
  if (!secret) return null;
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return createHmac("sha256", secret).update(`${purpose}:${ip}`).digest("hex");
}
