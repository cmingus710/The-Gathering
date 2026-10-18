import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";
import { SignUpForm } from "../forms";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="font-serif text-2xl font-semibold">Create your account</h1>
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
