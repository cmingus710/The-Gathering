import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { isOAuthErrorKind, oauthErrorCopy } from "@/lib/auth/oauth";
import { getOfferedProviders } from "@/lib/auth/oauth-config";
import { safeNextPath } from "@/lib/auth/redirects";
import { isSupabaseConfigured } from "@/lib/env";
import { SignInForm, SocialSignIn } from "../forms";
import { AuthHeading, authLinkClass } from "../ui";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const [params, providers] = await Promise.all([searchParams, getOfferedProviders()]);
  const next = safeNextPath(params.next);
  const oauthError = isOAuthErrorKind(params.oauth_error) ? oauthErrorCopy(params.oauth_error, params.provider) : null;
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
        {oauthError ? (
          <Alert tone="error" title={oauthError.title}>
            {oauthError.body}
          </Alert>
        ) : null}
        {!isSupabaseConfigured() ? (
          <Alert tone="warning" title="Sign-in isn't available yet">
            The membership service hasn&apos;t been configured. Please check back soon.
          </Alert>
        ) : null}
        <SocialSignIn providers={providers} next={next} />
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
