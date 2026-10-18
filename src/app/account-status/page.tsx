import { Hourglass, ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FullLogo } from "@/components/brand/logo";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { MembershipBadge } from "@/components/ui/badge";
import { requireSignedIn } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Account status" };

/** Where pending and suspended accounts land. Approved members go straight home. */
export default async function AccountStatusPage({ searchParams }: PageProps<"/account-status">) {
  const viewer = await requireSignedIn("/account-status");
  if (viewer.status === "approved") redirect("/home");
  const [{ settings }, params] = await Promise.all([getChurchSettings(), searchParams]);
  const suspended = viewer.status === "suspended";

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
      <FullLogo src={settings.logoUrl} alt={settings.churchName} className="mb-8 w-44 sm:w-52" priority />
      <main id="main" className="w-full max-w-lg">
        <div className="rounded-card border border-border bg-surface p-6 sm:p-8">
          {params.verified && !suspended ? (
            <Alert tone="success" title="Your email address is verified." className="mb-6" />
          ) : null}
          <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
            {suspended ? <ShieldOff className="size-7" aria-hidden="true" /> : <Hourglass className="size-7" aria-hidden="true" />}
          </div>
          <h1 className="font-serif text-2xl font-semibold">
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
          ) : (
            <>
              <p className="mt-4">
                A church administrator will review your account. Member areas open as soon as you&apos;re approved, and
                we&apos;ll email you when that happens.
              </p>
              <p className="mt-3 text-text-secondary">There&apos;s nothing else you need to do right now.</p>
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
            <SignOutButton className="w-auto" />
          </div>
        </div>
      </main>
    </div>
  );
}
