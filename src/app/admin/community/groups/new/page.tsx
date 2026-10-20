import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { CreateGroupForm } from "../../community-forms";

export const metadata: Metadata = { title: "New group" };

export default async function NewGroupPage() {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community/groups/new");
  return (
    <>
      <Link href="/admin/community/groups" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Groups
      </Link>
      <PageHeader title="New group" description="Every group starts with a leader. Leaders manage only their own group; they get no other administrative access." />
      <Card>
        <CreateGroupForm />
      </Card>
    </>
  );
}
