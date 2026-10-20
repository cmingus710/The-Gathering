import { ArrowLeft, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GroupImage } from "@/components/community/group-card";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { signGroupImages, tryCommunityRpc } from "@/lib/community/queries";
import type { GroupInvitation } from "@/lib/community/types";
import { RespondInvitation } from "../group-forms";

export const metadata: Metadata = { title: "Group invitations" };

export default async function InvitationsPage() {
  await requireApprovedMember("/groups/invitations");
  const data = await tryCommunityRpc<{ invitations: GroupInvitation[] }>("community_groups");
  const images = data ? await signGroupImages(data.invitations.map((i) => i.group.image_path)) : new Map<string, string>();
  return (
    <>
      <Link href="/groups" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Groups
      </Link>
      <PageHeader title="Group invitations" description="Joining is up to you. Invitations expire after 14 days." />
      {!data ? (
        <Alert tone="error" title="Invitations couldn't be loaded right now." />
      ) : data.invitations.length ? (
        <ul className="space-y-3">
          {data.invitations.map((i) => (
            <li key={i.id} className="flex gap-4 rounded-card border border-border bg-surface p-5">
              <GroupImage url={i.group.image_path ? images.get(i.group.image_path) : null} alt={i.group.image_alt} />
              <div className="min-w-0 flex-1 space-y-2">
                <h2 className="text-title font-semibold">{i.group.name}</h2>
                {i.group.summary ? <p className="text-meta text-text-secondary">{i.group.summary}</p> : null}
                <p className="text-sm text-text-secondary">
                  Invited by {i.invited_by} · expires {new Date(i.expires_at).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </p>
                <RespondInvitation invitationId={i.id} groupName={i.group.name} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Mail className="size-6" aria-hidden="true" />} title="No open invitations" />
      )}
    </>
  );
}
