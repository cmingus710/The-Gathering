import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { getViewer } from "@/lib/auth/viewer";
import { ResetPasswordForm } from "../forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  const result = await getViewer();
  const hasSession = result.state === "signed-in";
  return (
    <>
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      <div className="mt-6">
        {hasSession ? (
          <ResetPasswordForm />
        ) : (
          <div className="space-y-4">
            <Alert tone="error" title="This reset link has expired or was already used." />
            <Link href="/forgot-password" className="font-semibold text-primary underline-offset-2 hover:underline">
              Request a new link
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
