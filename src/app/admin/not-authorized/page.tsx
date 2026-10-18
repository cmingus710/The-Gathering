import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not authorized" };

export default function NotAuthorizedPage() {
  return (
    <div className="max-w-xl">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </div>
      <h1 className="font-serif text-2xl font-semibold">You don&apos;t have access to this area</h1>
      <p className="mt-2 text-text-secondary">
        Your role doesn&apos;t include this permission. If you need it, ask a super administrator.
      </p>
      <Link href="/admin" className="mt-4 inline-block font-semibold text-primary underline-offset-2 hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
