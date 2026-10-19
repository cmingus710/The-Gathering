import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getEmailConfig, getSupabasePublicConfig } from "@/lib/env";
import { getSiteUrl } from "@/lib/site-url";
import { createEventsJob, deliverEventEmails, type DeliveryDeps, type EventsJob, type Mailer } from "./jobs";

type Env = Record<string, string | undefined>;

export function parseAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

/**
 * EVENTS_JOB_SECRET (≥ 32 characters) enables email delivery and the
 * scheduled job; without it events, RSVPs, and feeds still work and emails
 * stay queued. Outside production, email goes only to EVENTS_EMAIL_ALLOWLIST
 * (falling back to GIVING_EMAIL_ALLOWLIST); with no allowlist, nothing is sent.
 */
export function getEventsConfig(env: Env = process.env) {
  const secret = env.EVENTS_JOB_SECRET?.trim() ?? "";
  const production = env.VERCEL_ENV === "production";
  return {
    jobSecret: secret.length >= 32 ? secret : null,
    production,
    allowlist: production ? null : parseAllowlist(env.EVENTS_EMAIL_ALLOWLIST ?? env.GIVING_EMAIL_ALLOWLIST),
  };
}

export function getEventsJob(): EventsJob | null {
  const config = getEventsConfig();
  const supabase = getSupabasePublicConfig();
  if (!config.jobSecret || !supabase) return null;
  const db = createSupabaseClient(supabase.url, supabase.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return createEventsJob(config.jobSecret, async (args) => {
    const { data, error } = await db.rpc("events_job", args);
    return { data, error };
  });
}

function getMailer(): Mailer | null {
  const email = getEmailConfig();
  if (!email) return null;
  return {
    async send(message) {
      const { Resend } = await import("resend");
      const resend = new Resend(email.apiKey);
      const { data, error } = await resend.emails.send(
        { from: email.from, to: message.to, subject: message.subject, text: message.text, html: message.html },
        { idempotencyKey: message.idempotencyKey },
      );
      if (error) return { ok: false, error: error.name ?? "rejected" };
      return { ok: true, id: data?.id ?? null };
    },
  };
}

export function getDeliveryDeps(churchName: string): DeliveryDeps | null {
  const job = getEventsJob();
  if (!job) return null;
  const config = getEventsConfig();
  return { job, mailer: getMailer(), allowlist: config.allowlist, siteUrl: getSiteUrl(), churchName, testMode: !config.production };
}

/** Sends any queued messages now (best effort; the scheduler retries). */
export async function deliverNow(churchName: string, occurrence?: string) {
  const deps = getDeliveryDeps(churchName);
  if (!deps) return;
  try {
    await deliverEventEmails(deps, { occurrence, rounds: 2 });
  } catch (err) {
    console.error("[events] immediate delivery failed", { error: (err as Error)?.name });
  }
}
