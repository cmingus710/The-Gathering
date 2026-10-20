import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "../forms";
import { AuthHeading, authLinkClass } from "../ui";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading title="Reset your password">
        Enter your account email and we&apos;ll send you a link to choose a new password.
      </AuthHeading>
      <div className="mt-8">
        <ForgotPasswordForm />
      </div>
      <p className="mt-8 text-center">
        <Link href="/sign-in" className={authLinkClass}>
          Back to sign in
        </Link>
      </p>
    </>
  );
}
