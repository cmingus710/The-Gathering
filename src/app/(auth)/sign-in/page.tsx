import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { safeNextPath } from "@/lib/auth/redirects";
import { isSupabaseConfigured } from "@/lib/env";
import { SignInForm } from "../forms";
import { AuthHeading, authLinkClass } from "../ui";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  return (
    <>
      <AuthHeading
        title={
          <>
            Welcome to <span className="whitespace-nowrap">The Gathering</span>
          </>
        }
      >
        Sign in to connect with your church community.
      </AuthHeading>
      <div className="mt-8 space-y-5">
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
      <p className="mt-8 text-center">
        New here?{" "}
        <Link href="/sign-up" className={authLinkClass}>
          Create an account
        </Link>
      </p>
    </>
  );
}
