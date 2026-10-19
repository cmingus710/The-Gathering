import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { safeNextPath } from "@/lib/auth/redirects";
import { isSupabaseConfigured } from "@/lib/env";
import { SignInForm } from "../forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  return (
    <>
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mt-1 text-text-secondary">Sign in to your member account.</p>
      <div className="mt-6 space-y-5">
        {params.signed_out ? <Alert tone="success" title="You've been signed out." /> : null}
        {params.error === "link" ? (
          <Alert tone="error" title="That link didn't work">
            It may have expired or already been used. Sign in, or request a new password reset link.
          </Alert>
        ) : null}
        {!isSupabaseConfigured() ? (
          <Alert tone="warning" title="Sign-in isn't available yet">
            The membership service hasn&apos;t been configured. Please check back soon.
          </Alert>
        ) : null}
        <SignInForm next={next} />
      </div>
      <p className="mt-6 border-t border-border pt-5 text-center">
        New here?{" "}
        <Link href="/sign-up" className="font-semibold text-primary underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
