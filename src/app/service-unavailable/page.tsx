import type { Metadata } from "next";
import Link from "next/link";
import { FullLogo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Service unavailable" };

export default function ServiceUnavailablePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-12">
      <FullLogo className="mb-8 w-44" />
      <main id="main" className="w-full max-w-md space-y-4">
        <h1 className="font-serif text-2xl font-semibold">We can&apos;t reach the member service</h1>
        <Alert tone="error" title={isSupabaseConfigured() ? "The service didn't respond." : "The member service isn't configured yet."}>
          {isSupabaseConfigured()
            ? "Please try again in a few minutes."
            : "An administrator needs to finish setting up the app. Please check back soon."}
        </Alert>
        <Link href="/" className="inline-block font-semibold text-primary underline-offset-2 hover:underline">
          Return to the welcome page
        </Link>
      </main>
    </div>
  );
}
