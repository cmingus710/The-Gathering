import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";
import { SignUpForm } from "../forms";
import { AuthHeading, authLinkClass } from "../ui";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <AuthHeading title="Create your account">
        After you verify your email, a church administrator will review your account before member areas open.
      </AuthHeading>
      <div className="mt-8 space-y-5">
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
      <p className="mt-8 text-center">
        Already have an account?{" "}
        <Link href="/sign-in" className={authLinkClass}>
          Sign in
        </Link>
      </p>
    </>
  );
}
