import { captchaErrorMessage, isCaptchaError } from "./captcha";

/**
 * Maps Supabase Auth errors to calm, actionable messages. Unknown errors get a
 * generic message; raw provider messages are never shown to members.
 */
type AuthLikeError = { code?: string; status?: number; message?: string; name?: string } | null | undefined;

export function authErrorMessage(error: AuthLikeError): string {
  if (!error) return "Something went wrong. Please try again.";
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  // Before the generic 5xx case: a failed Turnstile check can arrive as a 500.
  if (isCaptchaError(error)) return captchaErrorMessage(error);

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "That email and password don't match our records.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Please verify your email address first. Check your inbox for the verification link.";
  }
  if (code === "user_already_exists" || code === "email_exists") {
    return "An account with this email may already exist. Try signing in or resetting your password.";
  }
  if (code === "weak_password" || message.includes("password should")) {
    return "Please choose a stronger password (at least 10 characters, mixing letters and numbers).";
  }
  if (code === "same_password") {
    return "Your new password must be different from your current password.";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (code === "otp_expired" || message.includes("expired")) {
    return "This link has expired or was already used. Please request a new one.";
  }
  if (code === "signup_disabled") {
    return "New registrations are currently closed. Please contact the church office.";
  }
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500) {
    return "We couldn't reach the sign-in service. Please try again in a moment.";
  }
  return "Something went wrong. Please try again.";
}
