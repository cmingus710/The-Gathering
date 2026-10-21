import { getSiteUrl } from "@/lib/site-url";

/**
 * Google and Apple sign-in through Supabase Auth's OAuth (PKCE) flow.
 *
 * Everything here is pure so it can be unit tested; the server-only pieces
 * (reading Supabase's provider settings) live in oauth-config.ts.
 */
export const OAUTH_PROVIDERS = ["google", "apple"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<OAuthProvider, string> = { google: "Google", apple: "Apple" };

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Providers the operator has switched on for this deployment
 * (AUTH_OAUTH_PROVIDERS="google,apple"). A provider is only shown when it is
 * listed here AND Supabase reports it enabled, so a half-configured provider
 * never shows a button that fails.
 */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): OAuthProvider[] {
  const listed = (env.AUTH_OAUTH_PROVIDERS ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(isOAuthProvider);
  return OAUTH_PROVIDERS.filter((p) => listed.includes(p));
}

/** Manual identity linking must be switched on in Supabase too; this flag says it has been. */
export function identityLinkingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return ["on", "true", "1"].includes((env.AUTH_IDENTITY_LINKING ?? "").trim().toLowerCase());
}

function originOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Origins this deployment may send OAuth callbacks to (they must also be in Supabase's redirect allow list). */
export function allowedAuthOrigins(env: Record<string, string | undefined> = process.env): Set<string> {
  const origins = new Set<string>([getSiteUrl(env)]);
  if (env.VERCEL_ENV === "preview") {
    for (const host of [env.VERCEL_BRANCH_URL, env.VERCEL_URL]) {
      const o = originOf(host);
      if (o?.startsWith("https://")) origins.add(o);
    }
  }
  if (env.VERCEL_ENV === "production") {
    const o = originOf(env.VERCEL_PROJECT_PRODUCTION_URL);
    if (o?.startsWith("https://")) origins.add(o);
  }
  for (const extra of (env.AUTH_ALLOWED_ORIGINS ?? "").split(",")) {
    const o = originOf(extra.trim());
    if (o) origins.add(o);
  }
  return origins;
}

/**
 * The origin the OAuth flow returns to. The browser must come back to the
 * origin it started on, because the PKCE code verifier is a cookie on that
 * origin. The request's origin is only trusted when it is one of this
 * deployment's known origins; otherwise the canonical site URL is used, so a
 * forged Host or Origin header can never pick the destination.
 */
export function resolveAuthOrigin(requestOrigin: string | null | undefined, env: Record<string, string | undefined> = process.env): string {
  const site = getSiteUrl(env);
  const candidate = originOf(requestOrigin);
  if (!candidate) return site;
  if (allowedAuthOrigins(env).has(candidate)) return candidate;
  // Local development: any localhost port, never on Vercel.
  if (!env.VERCEL_ENV && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(candidate)) return candidate;
  return site;
}

export type OAuthIntent = "sign-in" | "link";

/** Supabase-to-app redirect URL for the OAuth callback (allow-listed in Supabase). */
export function oauthCallbackUrl(origin: string, intent: OAuthIntent, next: string, provider: OAuthProvider): string {
  const url = new URL("/auth/callback", origin);
  if (intent === "link") url.searchParams.set("intent", "link");
  url.searchParams.set("provider", provider);
  if (next !== "/home") url.searchParams.set("next", next);
  return url.toString();
}

export type OAuthErrorKind =
  | "cancelled"
  | "expired"
  | "conflict"
  | "verify_email"
  | "signup_disabled"
  | "linking_disabled"
  | "unavailable"
  | "failed";

const CANCELLED = new Set(["access_denied", "user_cancelled_authorize", "user_cancelled_login", "user_denied", "consent_required"]);
const EXPIRED = new Set([
  "flow_state_expired",
  "flow_state_not_found",
  "bad_code_verifier",
  "bad_oauth_state",
  "bad_oauth_callback",
  "otp_expired",
]);

/**
 * Maps the error a provider or Supabase Auth reports (as callback query
 * parameters, or from the code exchange) to a small set of member-facing
 * cases. Raw provider text is never shown.
 */
export function classifyOAuthError(input: {
  error?: string | null;
  code?: string | null;
  description?: string | null;
  name?: string | null;
}): OAuthErrorKind {
  const error = (input.error ?? "").toLowerCase();
  const code = (input.code ?? "").toLowerCase();
  const description = (input.description ?? "").toLowerCase();

  if (code === "identity_already_exists" || description.includes("already linked")) return "conflict";
  if (code === "manual_linking_disabled" || description.includes("manual linking")) return "linking_disabled";
  if (code === "provider_email_needs_verification" || description.includes("unverified email")) return "verify_email";
  if (code === "signup_disabled" || description.includes("signups not allowed")) return "signup_disabled";
  if (code === "provider_disabled" || description.includes("provider is not enabled")) return "unavailable";
  if (CANCELLED.has(error) || CANCELLED.has(code)) return "cancelled";
  if (EXPIRED.has(code) || input.name === "AuthPKCECodeVerifierMissingError" || description.includes("code verifier")) {
    return "expired";
  }
  if (description.includes("expired") || description.includes("flow state")) return "expired";
  return "failed";
}

export function isOAuthErrorKind(value: unknown): value is OAuthErrorKind {
  return typeof value === "string" && Object.hasOwn(OAUTH_ERROR_COPY, value);
}

/** Calm, actionable copy for each case. `{provider}` is replaced with "Google" / "Apple" / "that service". */
export const OAUTH_ERROR_COPY: Record<OAuthErrorKind, { title: string; body: string }> = {
  cancelled: {
    title: "Sign-in was cancelled",
    body: "Nothing was changed. You can try again, or use your email and password.",
  },
  expired: {
    title: "That sign-in didn't finish",
    body: "It took too long or was interrupted. Please start again here, and finish in the same browser or app you started in.",
  },
  conflict: {
    title: "That {provider} account is already connected to a different account here",
    body: "Nothing was changed. Sign in with that {provider} account to reach the other account, or contact the church office if you need your two accounts brought together. We never combine accounts automatically.",
  },
  verify_email: {
    title: "Your {provider} email address needs confirming",
    body: "Confirm your email address with {provider} first, then try again. Or sign in with your email and password.",
  },
  signup_disabled: {
    title: "New registrations are currently closed",
    body: "Existing members can still sign in. Please contact the church office if you need an account.",
  },
  linking_disabled: {
    title: "Connecting sign-in methods isn't available right now",
    body: "Nothing was changed. Please try again later or contact the church office.",
  },
  unavailable: {
    title: "Signing in with {provider} isn't available right now",
    body: "Please use your email and password instead.",
  },
  failed: {
    title: "We couldn't complete sign-in with {provider}",
    body: "Please try again, or use your email and password. If it keeps happening, contact the church office.",
  },
};

export function oauthErrorCopy(kind: OAuthErrorKind, provider: unknown): { title: string; body: string } {
  const name = isOAuthProvider(provider) ? PROVIDER_LABEL[provider] : "that service";
  const copy = OAUTH_ERROR_COPY[kind];
  return { title: copy.title.replaceAll("{provider}", name), body: copy.body.replaceAll("{provider}", name) };
}

/** Apple "Hide My Email" relay addresses forward to the member's real inbox. */
export function isApplePrivateRelay(email: string | null | undefined): boolean {
  return /@privaterelay\.appleid\.com$/i.test((email ?? "").trim());
}

export type IdentitySummary = { provider: string; identityId: string; email: string | null };

/**
 * Whether unlinking `provider` still leaves a sign-in method the member can
 * actually use: their email and password, or another provider that is
 * currently offered. Supabase separately refuses to unlink the last identity.
 */
export function canUnlink(identities: IdentitySummary[], provider: OAuthProvider, offered: readonly OAuthProvider[]): boolean {
  if (!identities.some((i) => i.provider === provider)) return false;
  const remaining = identities.filter((i) => i.provider !== provider);
  return remaining.some((i) => i.provider === "email" || (isOAuthProvider(i.provider) && offered.includes(i.provider)));
}

/** A display name offered by the provider (Google sends one; Apple's web flow never does). */
export function providerSuggestedName(metadata: Record<string, unknown> | null | undefined): string {
  for (const key of ["full_name", "name"]) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  return "";
}
