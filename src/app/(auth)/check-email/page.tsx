import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: PageProps<"/check-email">) {
  const { reason } = await searchParams;
  const reset = reason === "reset";
  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <MailCheck className="size-7" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold">Check your email</h1>
      {reset ? (
        <p className="mt-2 text-text-secondary">
          If an account exists for that address, we&apos;ve sent a link to choose a new password. The link expires soon, so use it
          shortly.
        </p>
      ) : (
        <>
          <p className="mt-2 text-text-secondary">
            We&apos;ve sent a verification link to your email address. Open it on this or any device to confirm your address.
          </p>
          <p className="mt-3 text-text-secondary">
            Once verified, your account will wait for a church administrator to approve it. We&apos;ll email you when it&apos;s ready.
          </p>
        </>
      )}
      <p className="mt-6 text-[0.95rem] text-text-secondary">Can&apos;t find it? Check your spam or promotions folder.</p>
      <Link href="/sign-in" className="mt-6 inline-block font-semibold text-primary underline-offset-2 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
