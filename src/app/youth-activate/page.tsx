import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoPlaque } from "@/components/brand/logo";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { requireSignedIn } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { ActivateForm } from "./activate-form";

export const metadata: Metadata = { title: "Activate youth account" };

/**
 * Where an invited youth enters their one-time code after signing up with
 * the invited email and confirming it. Works only for a fresh account (the
 * database refuses existing members), only while the church's policy allows
 * independent youth accounts, and only with a verified guardian's
 * authorization when the policy requires it.
 */
export default async function ActivatePage() {
  const viewer = await requireSignedIn("/youth-activate");
  if (viewer.status === "approved") redirect(viewer.accountKind === "youth" ? "/youth" : "/home");
  const { settings } = await getChurchSettings();
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
      <LogoPlaque src={settings.logoUrl} alt={settings.churchName} className="mb-8" logoClassName="w-32 sm:w-40" priority />
      <main id="main" className="w-full max-w-lg">
        <div className="space-y-4 rounded-card border border-border bg-surface p-6 sm:p-8">
          <h1 className="font-display text-2xl font-semibold">Activate your youth account</h1>
          <p className="text-text-secondary">
            Enter the code from your parent or guardian or the church office. You need to have confirmed your email address first (check your inbox
            for the link we sent when you signed up).
          </p>
          <ActivateForm />
          <div className="border-t border-border pt-4">
            <p className="mb-2 text-sm text-text-secondary">Signed in as {viewer.email}</p>
            <SignOutButton className="w-auto" />
          </div>
        </div>
      </main>
    </div>
  );
}
