import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { getOfferedProviders } from "@/lib/auth/oauth-config";
import { isSupabaseConfigured } from "@/lib/env";
import { SignUpForm, SocialSignIn } from "../forms";
import { AuthHeading, authLinkClass } from "../ui";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  const providers = await getOfferedProviders();
  return (
    <>
      <AuthHeading title="Create your account">
        {providers.length
          ? "A church administrator reviews every new account before member areas open."
          : "After you verify your email, a church administrator will review your account before member areas open."}
      </AuthHeading>
      <div className="mt-8 space-y-5">
        {!isSupabaseConfigured() ? (
          <Alert tone="warning" title="Registration isn't available yet">
            The membership service hasn&apos;t been configured. Please check back soon.
          </Alert>
        ) : null}
        <SocialSignIn providers={providers} next="/home" />
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
