/**
 * Cloudflare Turnstile for the Supabase Auth forms (sign-up, sign-in, resend
 * verification, forgot password).
 *
 * The browser only collects a one-time token. Supabase Auth checks it against
 * Cloudflare with the secret stored in its CAPTCHA settings (never in this
 * app), so the protection holds even if the widget is skipped. Google/Apple
 * sign-in needs no token: Supabase doesn't check CAPTCHA on /authorize or on
 * the PKCE code exchange. See docs/turnstile-captcha.md.
 */

/** Form field the widget's token travels in, from the form to the Server Action. */
export const CAPTCHA_FIELD = "captchaToken";

/** Cloudflare's public site key. Unset: no widget, and forms behave as before. */
export function turnstileSiteKey(): string | null {
  // Must be read as a literal so Next.js inlines it into the client bundle.
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key ? key : null;
}

/** The token from a submitted form, or undefined (Supabase decides whether it's required). */
export function captchaTokenFrom(formData: FormData): string | undefined {
  const value = formData.get(CAPTCHA_FIELD);
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  // Turnstile tokens are at most 2048 characters; anything longer isn't one.
  return token && token.length <= 2048 ? token : undefined;
}

type AuthLikeError = { code?: string; status?: number; message?: string } | null | undefined;

/**
 * Supabase rejected the request's CAPTCHA. A missing, spent, expired, or
 * invalid token is `captcha_failed` (400); a failed call from Supabase to
 * Cloudflare is a 500 whose message names the captcha.
 */
export function isCaptchaError(error: AuthLikeError): boolean {
  if (!error) return false;
  return error.code === "captcha_failed" || /captcha/i.test(error.message ?? "");
}

export const CAPTCHA_REJECTED_MESSAGE =
  "We couldn't confirm the security check. Please complete it again, then resubmit.";

export const CAPTCHA_SERVICE_MESSAGE =
  "The security check service didn't respond. Please wait a moment, complete the check again, and resubmit.";

export function captchaErrorMessage(error: AuthLikeError): string {
  return error?.code === "captcha_failed" ? CAPTCHA_REJECTED_MESSAGE : CAPTCHA_SERVICE_MESSAGE;
}

/**
 * Widget failures, from Cloudflare's error-callback code. Codes:
 * https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
 */
export function widgetErrorMessage(code: string | undefined): string {
  const c = code ?? "";
  if (c.startsWith("1101") || c === "110200") {
    // Invalid site key or a hostname missing from the widget: our setup, not the visitor's.
    return "The security check isn't set up for this web address yet. Please contact the church office.";
  }
  if (c === "200500") {
    return "The security check couldn't load. Check your connection or any content blocker, then try again.";
  }
  if (c.startsWith("1106")) return "The security check timed out. Please try again.";
  if (c.startsWith("300") || c.startsWith("600")) {
    return "The security check couldn't confirm this browser. Please try again, or try another browser.";
  }
  return "The security check didn't complete. Please try again.";
}
