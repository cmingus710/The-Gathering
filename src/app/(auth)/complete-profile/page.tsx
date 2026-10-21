import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { isApplePrivateRelay, providerSuggestedName } from "@/lib/auth/oauth";
import { safeNextPath } from "@/lib/auth/redirects";
import { requireSignedIn } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { CompleteProfileForm } from "../forms";
import { AuthHeading } from "../ui";

export const metadata: Metadata = { title: "Tell us your name" };

/**
 * Shown after Google or Apple sign-in when the account has no name yet
 * (Apple's web sign-in never shares one). Only the name is asked for: the
 * email the provider shared, including an Apple private relay address, is
 * kept as it is.
 */
export default async function CompleteProfilePage({ searchParams }: PageProps<"/complete-profile">) {
  const viewer = await requireSignedIn("/complete-profile");
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (viewer.status === "suspended") redirect("/account-status");
  if (viewer.fullName.trim()) redirect(next);

  const supabase = await requireClient();
  const { data } = await supabase.auth.getUser();
  const suggestedName = providerSuggestedName(data.user?.user_metadata);

  return (
    <>
      <AuthHeading title="Tell us your name">
        Your sign-in service didn&apos;t share it. The church office uses your name to recognize you before approving your
        account.
      </AuthHeading>
      <div className="mt-8 space-y-5">
        {isApplePrivateRelay(viewer.email) ? (
          <Alert tone="info" title="You're using Hide My Email" live={false}>
            Church emails go to <span className="break-all font-semibold">{viewer.email}</span>, and Apple forwards them
            to you. You can see this address any time in your Apple Account settings under Sign in with Apple.
          </Alert>
        ) : null}
        <CompleteProfileForm next={next} suggestedName={suggestedName} />
        <div className="border-t border-border pt-4 text-center">
          <p className="mb-2 text-meta text-text-secondary">Signed in as {viewer.email}</p>
          <SignOutButton className="mx-auto w-auto" />
        </div>
      </div>
    </>
  );
}
