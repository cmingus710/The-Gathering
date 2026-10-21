import { Hourglass, ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoPlaque } from "@/components/brand/logo";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { MembershipBadge } from "@/components/ui/badge";
import { isApplePrivateRelay, isOAuthProvider, PROVIDER_LABEL } from "@/lib/auth/oauth";
import { requireSignedIn } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Account status" };

/** Where pending and suspended accounts land. Approved members go straight home. */
export default async function AccountStatusPage({ searchParams }: PageProps<"/account-status">) {
  const viewer = await requireSignedIn("/account-status");
  if (viewer.status === "approved") redirect("/home");
  if (viewer.status === "pending" && !viewer.fullName.trim()) redirect("/complete-profile?next=%2Faccount-status");
  const [{ settings }, params] = await Promise.all([getChurchSettings(), searchParams]);
  const suspended = viewer.status === "suspended";
  // A pending account that only signs in with Google/Apple may be a second
  // account for someone who already registered with another email.
  const socialOnly = viewer.authProviders.length > 0 && viewer.authProviders.every(isOAuthProvider);
  const socialName = socialOnly ? PROVIDER_LABEL[viewer.authProviders[0] as keyof typeof PROVIDER_LABEL] : null;

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
      <LogoPlaque src={settings.logoUrl} alt={settings.churchName} className="mb-8" logoClassName="w-32 sm:w-40" priority />
      <main id="main" className="w-full max-w-lg">
        <div className="rounded-card border border-border bg-surface p-6 sm:p-8">
          {params.verified && !suspended ? (
            <Alert tone="success" title="Your email address is verified." className="mb-6" />
          ) : null}
          <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
            {suspended ? <ShieldOff className="size-7" aria-hidden="true" /> : <Hourglass className="size-7" aria-hidden="true" />}
          </div>
          <h1 className="font-display text-2xl font-semibold">
            {suspended ? "Your access is paused" : "Thanks for registering"}
          </h1>
          <p className="mt-2">
            <span className="sr-only">Account status: </span>
            <MembershipBadge status={viewer.status} />
          </p>
          {suspended ? (
            <p className="mt-4 text-text-secondary">
              Your member access has been suspended. If you think this is a mistake, please reach out to the church office.
            </p>
          ) : viewer.accountKind === "youth" ? (
            <>
              <p className="mt-4">This account was set up for a youth invitation.</p>
              <p className="mt-3">
                <a className="font-semibold text-primary underline-offset-2 hover:underline" href="/youth-activate">
                  Enter your invitation code
                </a>{" "}
                to finish. Your parent or guardian, or the church office, has the code.
              </p>
            </>
          ) : (
            <>
              <p className="mt-4">
                A church administrator will review your account. Member areas open as soon as you&apos;re approved, and
                we&apos;ll email you when that happens.
              </p>
              <p className="mt-3 text-text-secondary">There&apos;s nothing else you need to do right now.</p>
              {socialName ? (
                <Alert tone="info" title="Already a member with a different email?" className="mt-5" live={false}>
                  This is a new account created with {socialName}. If you already have an account here, sign out, sign in
                  the way you usually do, and connect {socialName} from Profile → Sign-in methods. Then let the church office
                  know so they can remove this extra registration. Nothing from your existing account is changed.
                </Alert>
              ) : null}
            </>
          )}
          {settings.contactEmail || settings.contactPhone ? (
            <p className="mt-4 text-text-secondary">
              Questions? Contact{" "}
              {settings.contactEmail ? (
                <a className="font-semibold text-primary underline-offset-2 hover:underline" href={`mailto:${settings.contactEmail}`}>
                  {settings.contactEmail}
                </a>
              ) : null}
              {settings.contactEmail && settings.contactPhone ? " or " : null}
              {settings.contactPhone ? (
                <a className="font-semibold text-primary underline-offset-2 hover:underline" href={`tel:${settings.contactPhone.replace(/[^0-9+]/g, "")}`}>
                  {settings.contactPhone}
                </a>
              ) : null}
              .
            </p>
          ) : null}
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-sm text-text-secondary">Signed in as {viewer.email}</p>
            {isApplePrivateRelay(viewer.email) ? (
              <p className="mb-2 text-sm text-text-secondary">
                This is an Apple private relay address (Hide My Email); Apple forwards church emails to you.
              </p>
            ) : null}
            <SignOutButton className="w-auto" />
          </div>
        </div>
      </main>
    </div>
  );
}
