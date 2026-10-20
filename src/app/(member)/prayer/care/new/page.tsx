import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CareRequestForm } from "@/components/prayer/care-forms";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Request help" };

export default async function NewCarePage() {
  const viewer = await requireApprovedMember("/prayer/care/new");
  return (
    <>
      <Link href="/prayer/care" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> My care requests
      </Link>
      <PageHeader title="Request help" description="Meals, transportation, visits, or other practical help. Your request goes privately to the care team." />
      <div className="max-w-2xl">
        <CareRequestForm hasPhone={Boolean(viewer.phone?.trim())} />
      </div>
    </>
  );
}
