import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "@/lib/env";

export class ServiceUnavailableError extends Error {
  constructor(message = "The membership service is not configured. Please contact the church office.") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * Per-request Supabase client acting as the signed-in user (RLS applies).
 * Returns null when Supabase is not configured so callers can show a clear
 * "service unavailable" message instead of pretending to work.
 */
export async function createClient(): Promise<SupabaseClient | null> {
  // Read cookies first so every caller is request-bound, even when unconfigured.
  const cookieStore = await cookies();
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes sessions, so this is safe to ignore.
        }
      },
    },
  });
}

export async function requireClient(): Promise<SupabaseClient> {
  const client = await createClient();
  if (!client) throw new ServiceUnavailableError();
  return client;
}
