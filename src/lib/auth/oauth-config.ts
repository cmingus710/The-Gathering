import "server-only";
import { cache } from "react";
import { getSupabasePublicConfig } from "@/lib/env";
import { OAUTH_PROVIDERS, providersFromEnv, type OAuthProvider } from "./oauth";

/**
 * The providers to offer: switched on for this deployment (AUTH_OAUTH_PROVIDERS)
 * AND reported enabled by Supabase Auth's public settings endpoint. If
 * Supabase can't be reached, no provider buttons are shown; email and
 * password keep working.
 */
export const getOfferedProviders = cache(async (): Promise<OAuthProvider[]> => {
  const wanted = providersFromEnv();
  const config = getSupabasePublicConfig();
  if (!wanted.length || !config) return [];
  try {
    const res = await fetch(`${config.url.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const settings = (await res.json()) as { external?: Record<string, unknown> };
    return OAUTH_PROVIDERS.filter((p) => wanted.includes(p) && settings.external?.[p] === true);
  } catch {
    return [];
  }
});
