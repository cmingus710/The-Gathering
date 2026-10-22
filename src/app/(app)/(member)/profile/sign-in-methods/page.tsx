import { ArrowLeft, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AppleLogo, GoogleLogo } from "@/components/auth/provider-logos";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/card";
import {
  OAUTH_PROVIDERS,
  PROVIDER_LABEL,
  canUnlink,
  identityLinkingEnabled,
  isApplePrivateRelay,
  isOAuthErrorKind,
  isOAuthProvider,
  oauthErrorCopy,
} from "@/lib/auth/oauth";
import { getOfferedProviders } from "@/lib/auth/oauth-config";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { ConnectProvider, DisconnectProvider } from "./controls";
import { loadIdentities } from "./identities";

export const metadata: Metadata = { title: "Sign-in methods" };

export default async function SignInMethodsPage({ searchParams }: PageProps<"/profile/sign-in-methods">) {
  const viewer = await requireApprovedMember("/profile/sign-in-methods");
  const supabase = await requireClient();
  const [params, identities, offered] = await Promise.all([searchParams, loadIdentities(supabase), getOfferedProviders()]);
  const linking = identityLinkingEnabled();
  const summary = identities?.summary ?? [];
  const hasPassword = summary.some((i) => i.provider === "email");

  const linked = isOAuthProvider(params.linked) ? PROVIDER_LABEL[params.linked] : null;
  const unlinked = isOAuthProvider(params.unlinked) ? PROVIDER_LABEL[params.unlinked] : null;
  const blocked = isOAuthProvider(params.unlink_blocked) ? PROVIDER_LABEL[params.unlink_blocked] : null;
  const error = isOAuthErrorKind(params.oauth_error) ? oauthErrorCopy(params.oauth_error, params.provider) : null;
  // Show a provider if it's offered now, or if it's already on the account.
  const shown = OAUTH_PROVIDERS.filter((p) => offered.includes(p) || summary.some((i) => i.provider === p));

  return (
    <>
      <Link href="/profile" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Profile
      </Link>
      <PageHeader title="Sign-in methods" description="The ways you can sign in to this account. They all open the same account." />

      <div className="max-w-2xl space-y-5">
        {linked ? <Alert tone="success" title={`${linked} is connected. You can now sign in with ${linked}.`} /> : null}
        {unlinked ? <Alert tone="success" title={`${unlinked} is disconnected.`} /> : null}
        {blocked ? (
          <Alert tone="warning" title={`${blocked} wasn't disconnected`}>
            You need at least one other way to sign in first, such as your email and password.
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="error" title={error.title}>
            {error.body}
          </Alert>
        ) : null}
        {!identities ? (
          <Alert tone="error" title="We couldn't load your sign-in methods right now.">
            Please try again in a moment.
          </Alert>
        ) : null}

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h2 className="font-semibold">Email and password</h2>
                <p className="break-all text-meta text-text-secondary">{viewer.email}</p>
              </div>
            </div>
            {hasPassword ? <Badge>Connected</Badge> : <Badge>Not set up</Badge>}
          </div>
          {hasPassword ? (
            <Link href="/reset-password" className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
              Change password
            </Link>
          ) : null}
        </Card>

        {shown.map((provider) => {
          const identity = summary.find((i) => i.provider === provider);
          const name = PROVIDER_LABEL[provider];
          const removable = linking && identity && canUnlink(summary, provider, offered);
          return (
            <Card key={provider}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {provider === "google" ? (
                    <GoogleLogo className="mt-0.5 size-5 shrink-0" />
                  ) : (
                    <AppleLogo className="mt-0.5 h-5 w-auto shrink-0" />
                  )}
                  <div>
                    <h2 className="font-semibold">{name}</h2>
                    {identity?.email ? (
                      <p className="break-all text-meta text-text-secondary">
                        {identity.email}
                        {isApplePrivateRelay(identity.email) ? " (Hide My Email)" : null}
                      </p>
                    ) : null}
                  </div>
                </div>
                <Badge>{identity ? "Connected" : "Not connected"}</Badge>
              </div>
              <div className="mt-4">
                {identity ? (
                  removable ? (
                    <DisconnectProvider provider={provider} />
                  ) : linking ? (
                    <p className="text-meta text-text-secondary">
                      This is your only way to sign in that&apos;s available right now, so it can&apos;t be disconnected.
                    </p>
                  ) : null
                ) : linking && offered.includes(provider) ? (
                  <ConnectProvider provider={provider} />
                ) : (
                  <p className="text-meta text-text-secondary">Connecting {name} isn&apos;t available yet.</p>
                )}
              </div>
            </Card>
          );
        })}

        <Alert tone="info" title="About connecting accounts" live={false}>
          Connecting {shown.length ? shown.map((p) => PROVIDER_LABEL[p]).join(" or ") : "another service"} only adds a way
          to sign in. It doesn&apos;t change your membership, your email here, or anything in your account. An account that
          is already used by a different account here can&apos;t be connected; contact the church office if you need two
          accounts brought together.
        </Alert>
      </div>
    </>
  );
}
