import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "../forms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="font-serif text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-text-secondary">Enter your account email and we&apos;ll send you a link to choose a new password.</p>
      <div className="mt-6">
        <ForgotPasswordForm />
      </div>
      <p className="mt-6 border-t border-border pt-5 text-center">
        <Link href="/sign-in" className="font-semibold text-primary underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
