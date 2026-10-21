"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authErrorMessage } from "@/lib/auth/errors";
import { isOAuthProvider, oauthCallbackUrl, oauthErrorCopy, resolveAuthOrigin } from "@/lib/auth/oauth";
import { getOfferedProviders } from "@/lib/auth/oauth-config";
import { safeNextPath } from "@/lib/auth/redirects";
import { completeProfileSchema, forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema } from "@/lib/auth/schemas";
import { errorState, formValues, validationErrorState, type FormState } from "@/lib/forms";
import { authConfirmUrl } from "@/lib/site-url";
import { registrationEnvironment } from "@/lib/membership/alerts";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Sign-in is temporarily unavailable because the membership service isn't configured. Please contact the church office.";

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["password", "confirmPassword"]);
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationErrorState(parsed.error, values);

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: authConfirmUrl("/account-status"),
      // Only the display name is copied to the profile; the database ignores
      // anything else. registration_environment keeps a preview sign-up's
      // approval alert away from production recipients (it can only suppress
      // the registrant's own alert).
      data: { full_name: parsed.data.fullName, registration_environment: registrationEnvironment() },
    },
  });
  if (error) return errorState(authErrorMessage(error), { values });

  // If the project has email confirmation turned off a session is returned
  // immediately; the account is still pending approval either way.
  if (data.session) redirect("/account-status");
  redirect("/check-email?reason=verify");
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ["password"]);
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationErrorState(parsed.error, values);

  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return errorState(authErrorMessage(error), {
      values: { ...values, unverified: error.code === "email_not_confirmed" ? "1" : "" },
    });
  }
  redirect(safeNextPath(formData.get("next")));
}

/**
 * Starts "Continue with Google / Apple" (Supabase OAuth, PKCE). The code
 * verifier is stored as a cookie here; /auth/callback exchanges the code.
 * New accounts get the same pending profile as email registrations (the
 * database trigger creates it); nothing here approves anyone.
 */
export async function startOAuthAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const provider = formData.get("provider");
  if (!isOAuthProvider(provider) || !(await getOfferedProviders()).includes(provider)) {
    const copy = oauthErrorCopy("unavailable", provider);
    return errorState(`${copy.title}. ${copy.body}`);
  }
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);

  const next = safeNextPath(formData.get("next"));
  const origin = resolveAuthOrigin((await headers()).get("origin"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: oauthCallbackUrl(origin, "sign-in", next, provider),
      skipBrowserRedirect: true,
      // Let people on shared devices pick the right Google account.
      queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
    },
  });
  if (error || !data.url) return errorState(authErrorMessage(error));
  redirect(data.url);
}

export async function resendVerificationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return validationErrorState(parsed.error);
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: authConfirmUrl("/account-status") },
  });
  if (error && (error.status === 429 || (error.status ?? 0) >= 500 || error.status === 0)) {
    return errorState(authErrorMessage(error));
  }
  return { status: "success", message: "If that account still needs verifying, a new link is on its way." };
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationErrorState(parsed.error, values);
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: authConfirmUrl("/reset-password") });
  // Don't reveal whether an account exists; only surface service problems.
  if (error && (error.status === 429 || (error.status ?? 0) >= 500 || error.status === 0)) {
    return errorState(authErrorMessage(error), { values });
  }
  redirect("/check-email?reason=reset");
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationErrorState(parsed.error);
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE);

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return errorState("Your reset link has expired or was already used. Please request a new one.");
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return errorState(authErrorMessage(error));
  redirect("/home?notice=password-updated");
}

/**
 * Saves the name a Google/Apple account arrived without. Only the member's own
 * name columns can change (column grants and RLS); status and roles can't.
 */
export async function completeProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = completeProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationErrorState(parsed.error, values);
  const supabase = await createClient();
  if (!supabase) return errorState(UNAVAILABLE, { values });

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/sign-in?next=%2Fcomplete-profile");
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, preferred_name: parsed.data.preferredName })
    .eq("id", userData.user.id);
  if (error) return errorState("We couldn't save your name. Please try again.", { values });
  redirect(safeNextPath(formData.get("next")));
}
