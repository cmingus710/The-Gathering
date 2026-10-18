"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { PASSWORD_MIN } from "@/lib/auth/schemas";
import { initialFormState } from "@/lib/forms";
import {
  forgotPasswordAction,
  resendVerificationAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, initialFormState);
  const v = state.values ?? {};
  return (
    <div className="space-y-5">
      <form action={action} noValidate className="space-y-5">
        <FormMessage state={state} />
        <input type="hidden" name="next" value={next} />
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
          autoComplete="current-password"
          required
          error={state.fieldErrors?.password}
        />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="font-semibold text-primary underline-offset-2 hover:underline">
            Forgot your password?
          </Link>
        </div>
        <SubmitButton pendingText="Signing in…" className="w-full">
          Sign in
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
