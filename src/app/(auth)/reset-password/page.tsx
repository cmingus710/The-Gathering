import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { getViewer } from "@/lib/auth/viewer";
import { ResetPasswordForm } from "../forms";
import { AuthHeading, authLinkClass } from "../ui";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  const result = await getViewer();
  const hasSession = result.state === "signed-in";
  return (
    <>
      <AuthHeading title="Choose a new password" />
      <div className="mt-8">
        {hasSession ? (
          <ResetPasswordForm />
        ) : (
          <div className="space-y-4">
            <Alert tone="error" title="This reset link has expired or was already used." />
            <Link href="/forgot-password" className={authLinkClass}>
              Request a new link
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
