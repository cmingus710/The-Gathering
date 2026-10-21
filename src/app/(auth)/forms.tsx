"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ProviderButton } from "@/components/auth/provider-button";
import { cn } from "@/components/ui/cn";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { PasswordField } from "@/components/ui/password-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PROVIDER_LABEL, type OAuthProvider } from "@/lib/auth/oauth";
import { PASSWORD_MIN } from "@/lib/auth/schemas";
import { initialFormState } from "@/lib/forms";
import {
  completeProfileAction,
  forgotPasswordAction,
  resendVerificationAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
  startOAuthAction,
} from "./actions";
import { authLinkClass } from "./ui";

/**
 * "Continue with Google / Apple" above the email form, with an "or" divider.
 * Renders nothing unless at least one provider is configured.
 */
export function SocialSignIn({ providers, next }: { providers: OAuthProvider[]; next: string }) {
  const [state, action] = useActionState(startOAuthAction, initialFormState);
  if (!providers.length) return null;
  return (
    <div className="space-y-5">
      <form action={action} className="space-y-3">
        <FormMessage state={state} />
        <input type="hidden" name="next" value={next} />
        {providers.map((p) => (
          <ProviderButton key={p} provider={p} label={`Continue with ${PROVIDER_LABEL[p]}`} />
        ))}
      </form>
      <div className="flex items-center gap-4" role="separator" aria-label="or">
        <span aria-hidden="true" className="h-px flex-1 bg-border-strong/50" />
        <span aria-hidden="true" className="font-serif text-meta tracking-[0.12em] text-text-secondary">
          or
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border-strong/50" />
      </div>
    </div>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, initialFormState);
  const v = state.values ?? {};
  return (
    <div className="space-y-5">
      <form action={action} noValidate className="space-y-5">
        <FormMessage state={state} />
        <input type="hidden" name="next" value={next} />
        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          required
          defaultValue={v.email}
          error={state.fieldErrors?.email}
        />
        <div className="space-y-2">
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            required
            error={state.fieldErrors?.password}
          />
          <div className="flex justify-end">
            <Link href="/forgot-password" className={cn(authLinkClass, "inline-flex min-h-11 items-center text-meta")}>
              Forgot password?
            </Link>
          </div>
        </div>
        <SubmitButton pendingText="Signing in…" size="lg" className="w-full font-serif tracking-[0.02em]">
          Sign In
        </SubmitButton>
      </form>
      {v.unverified === "1" && v.email ? <ResendVerification email={v.email} /> : null}
    </div>
  );
}

export function ResendVerification({ email }: { email: string }) {
  const [state, action] = useActionState(resendVerificationAction, initialFormState);
  return (
    <form action={action} className="space-y-3 rounded-control bg-surface-muted p-4">
      <input type="hidden" name="email" value={email} />
      <p className="text-[0.98rem]">Didn&apos;t get the verification email?</p>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" size="sm" pendingText="Sending…">
        Send a new verification link
      </SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextField
        label="Full name"
        name="fullName"
        autoComplete="name"
        required
        defaultValue={v.fullName}
        error={state.fieldErrors?.fullName}
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={v.email}
        error={state.fieldErrors?.email}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        hint={`At least ${PASSWORD_MIN} characters, including a letter and a number.`}
        error={state.fieldErrors?.password}
      />
      <TextField
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton pendingText="Creating account…" className="w-full">
        Create account
      </SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, initialFormState);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <SubmitButton pendingText="Sending link…" className="w-full">
        Send reset link
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPasswordAction, initialFormState);
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        hint={`At least ${PASSWORD_MIN} characters, including a letter and a number.`}
        error={state.fieldErrors?.password}
      />
      <TextField
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton pendingText="Saving…" className="w-full">
        Save new password
      </SubmitButton>
    </form>
  );
}

export function CompleteProfileForm({ next, suggestedName }: { next: string; suggestedName: string }) {
  const [state, action] = useActionState(completeProfileAction, initialFormState);
  const v = state.values ?? {};
  return (
    <form action={action} noValidate className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next} />
      <TextField
        label="Full name"
        name="fullName"
        autoComplete="name"
        required
        hint="Your first and last name, so the church office can recognize you."
        defaultValue={v.fullName ?? suggestedName}
        error={state.fieldErrors?.fullName}
      />
      <TextField
        label="Preferred name"
        name="preferredName"
        autoComplete="nickname"
        optional
        hint="What you like to be called, if different."
        defaultValue={v.preferredName}
        error={state.fieldErrors?.preferredName}
      />
      <SubmitButton pendingText="Saving…" className="w-full">
        Continue
      </SubmitButton>
    </form>
  );
}
