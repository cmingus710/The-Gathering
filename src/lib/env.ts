/**
 * Environment access. Only NEXT_PUBLIC_* values may reach the browser.
 * Service credentials (SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY) are
 * deliberately not read anywhere in the app runtime; they are used only by
 * operator scripts in /scripts.
 */
export type SupabasePublicConfig = { url: string; publishableKey: string };

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicConfig() !== null;
}

export type EmailConfig = { apiKey: string; from: string };

export function getEmailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}
