/**
 * Absolute base URL used in auth email links.
 *
 * Never derived from the request Host header (which a client controls) so
 * links in emails cannot be pointed at another domain.
 *  1. NEXT_PUBLIC_SITE_URL                  — production / explicit override
 *  2. VERCEL_BRANCH_URL or VERCEL_URL      — Vercel preview deployments
 *  3. http://localhost:3000                — local development
 */
export function getSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (env.VERCEL_ENV === "preview") {
    const host = env.VERCEL_BRANCH_URL || env.VERCEL_URL;
    if (host) return `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}

/**
 * Where Supabase auth emails send people back to (must be allow-listed in
 * Supabase). It always carries a query string so the email templates can
 * append `&token_hash=…&type=…` uniformly (see docs/setup.md).
 */
export function authConfirmUrl(next: "/account-status" | "/reset-password", env?: Record<string, string | undefined>): string {
  return `${getSiteUrl(env)}/auth/confirm?next=${encodeURIComponent(next)}`;
}
