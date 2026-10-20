/**
 * Giving configuration. Stripe is used in TEST MODE ONLY during Phase 3:
 * live keys are refused here, and live-mode events are refused again by the
 * database (giving.settings.allow_live_mode is constrained to false).
 *
 * Server-only environment variables (never NEXT_PUBLIC):
 *   STRIPE_SECRET_KEY       sk_test_… or rk_test_… (restricted key recommended)
 *   STRIPE_WEBHOOK_SECRET   whsec_… for the single test webhook endpoint
 *   GIVING_INGEST_SECRET    shared with the database (giving.secrets 'ingest')
 *   GIVING_EMAIL_ALLOWLIST  comma-separated addresses that may receive test-mode emails
 *   GIVING_WEBHOOK_HOST     the dedicated webhook hostname (only the webhook is served there)
 */
type Env = Record<string, string | undefined>;

export type StripeKeyCheck = { ok: true; secretKey: string } | { ok: false; reason: "missing" | "live_blocked" | "invalid" };

export function checkStripeKey(key: string | undefined): StripeKeyCheck {
  const k = key?.trim();
  if (!k) return { ok: false, reason: "missing" };
  if (/^(sk|rk)_live_/.test(k)) return { ok: false, reason: "live_blocked" };
  if (!/^(sk|rk)_test_[A-Za-z0-9]{10,}$/.test(k)) return { ok: false, reason: "invalid" };
  return { ok: true, secretKey: k };
}

export type GivingServerConfig = {
  secretKey: string;
  webhookSecret: string | null;
  ingestSecret: string;
  emailAllowlist: string[];
};

export type GivingConfigResult = { ok: true; config: GivingServerConfig } | { ok: false; reason: string };

export function getGivingConfig(env: Env = process.env): GivingConfigResult {
  const key = checkStripeKey(env.STRIPE_SECRET_KEY);
  if (!key.ok) {
    if (key.reason === "live_blocked") console.error("[giving] A live Stripe key is configured; live giving is disabled in this phase.");
    return { ok: false, reason: key.reason === "missing" ? "stripe_not_configured" : `stripe_key_${key.reason}` };
  }
  const ingestSecret = env.GIVING_INGEST_SECRET?.trim();
  if (!ingestSecret || ingestSecret.length < 32) return { ok: false, reason: "ingest_not_configured" };
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  return {
    ok: true,
    config: {
      secretKey: key.secretKey,
      webhookSecret: webhookSecret && webhookSecret.startsWith("whsec_") ? webhookSecret : null,
      ingestSecret,
      emailAllowlist: parseAllowlist(env.GIVING_EMAIL_ALLOWLIST),
    },
  };
}

export function parseAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

/** The dedicated hostname that serves only the Stripe webhook, if configured. */
export function webhookHost(env: Env = process.env): string | null {
  const h = env.GIVING_WEBHOOK_HOST?.trim().toLowerCase();
  return h && /^[a-z0-9.-]+$/.test(h) ? h : null;
}

export const WEBHOOK_PATH = "/api/stripe/webhook";
