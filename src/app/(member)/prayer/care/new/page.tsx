import type { Metadata } from "next";
import { CareRequestForm } from "@/components/prayer/care-forms";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Request help" };

export default async function NewCarePage() {
  const viewer = await requireApprovedMember("/prayer/care/new");
  return (
    <>
      <BackLink route="/prayer/care/new" />
      <PageHeader title="Request help" description="Meals, transportation, visits, or other practical help. Your request goes privately to the care team." />
      <div className="max-w-2xl">
        <CareRequestForm hasPhone={Boolean(viewer.phone?.trim())} />
      </div>
    </>
  );
}
