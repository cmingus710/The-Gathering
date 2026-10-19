import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { getEmailConfig, getSupabasePublicConfig } from "@/lib/env";
import { getSiteUrl } from "@/lib/site-url";
import { getGivingConfig, type GivingServerConfig } from "./config";
import { createIngest, type Ingest } from "./ingest";
import type { Mailer, ProcessorDeps } from "./processor";

export type GivingServer = ProcessorDeps & { config: GivingServerConfig };

/**
 * Server-side giving dependencies, or null when giving isn't configured.
 * The Stripe client is pinned to the SDK's API version. The ingest client
 * uses the publishable key plus the HMAC secret; no service-role key is used.
 */
export function getGivingServer(): GivingServer | null {
  const result = getGivingConfig();
  const supabase = getSupabasePublicConfig();
  if (!result.ok || !supabase) return null;
  const { config } = result;

  const db = createSupabaseClient(supabase.url, supabase.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const ingest: Ingest = createIngest(config.ingestSecret, async (args) => {
    const { data, error } = await db.rpc("giving_ingest", args);
    return { data, error };
  });
  const stripe = new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "The Gathering" } });

  const email = getEmailConfig();
  const mailer: Mailer | null = email
    ? {
        from: email.from,
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
      }
    : null;

  return { config, stripe, ingest, mailer, siteUrl: getSiteUrl(), emailAllowlist: config.emailAllowlist };
}

/** The real Stripe SDK client, for server actions that call Stripe directly. */
export function stripeClient(server: GivingServer): Stripe {
  return server.stripe as unknown as Stripe;
}
