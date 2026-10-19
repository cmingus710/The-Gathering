import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";
import { SignUpForm } from "../forms";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="mt-1 text-text-secondary">
        After you verify your email, a church administrator will review your account before member areas open.
      </p>
      <div className="mt-6 space-y-5">
        {!isSupabaseConfigured() ? (
          <Alert tone="warning" title="Registration isn't available yet">
            The membership service hasn&apos;t been configured. Please check back soon.
          </Alert>
        ) : null}
        <SignUpForm />
        <Alert tone="info" title="About the member directory" live={false}>
          Once you&apos;re approved, your name appears in the members-only directory, which only signed-in approved members
          can see. Your phone, email, address, and birthday stay hidden unless you choose to share them, and you can hide
          your whole listing at any time from your profile.
        </Alert>
      </div>
      <p className="mt-6 border-t border-border pt-5 text-center">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-primary underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
