import { ArrowLeft, EyeOff, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { ArchiveGroupButton } from "../community-forms";

export const metadata: Metadata = { title: "Groups" };

type AdminGroup = {
  id: string;
  name: string;
  visibility: "discoverable" | "hidden";
  status: "active" | "archived";
  accepts_requests: boolean;
  members: number;
  leaders: Array<{ id: string; name: string; approved: boolean }>;
};

export default async function AdminGroupsPage() {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community/groups");
  const groups = await tryCommunityRpc<AdminGroup[]>("community_admin_groups");
  return (
    <>
      <Link href="/admin/community" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Community
      </Link>
      <PageHeader
        title="Groups"
        description="Create groups, appoint leaders, and archive groups. You can see hidden groups and their members here, but not their discussions."
        actions={
          <ButtonLink href="/admin/community/groups/new" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
            New group
          </ButtonLink>
        }
      />
      {!groups ? (
        <Alert tone="error" title="Groups couldn't be loaded." />
      ) : groups.length ? (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-4">
              <div className="min-w-0">
                <Link href={`/groups/${g.id}/manage`} className="font-semibold hover:underline">
                  {g.name}
                </Link>
                <p className="flex flex-wrap gap-x-3 text-meta text-text-secondary">
                  <span>{g.status === "archived" ? "Archived" : "Active"}</span>
                  <span className="inline-flex items-center gap-1">
                    {g.visibility === "hidden" ? <EyeOff className="size-3.5" aria-hidden="true" /> : null}
                    {g.visibility === "hidden" ? "Hidden" : g.accepts_requests ? "Discoverable · takes requests" : "Discoverable · invitation only"}
                  </span>
                  <span>{g.members === 1 ? "1 member" : `${g.members} members`}</span>
                  <span>
                    Leaders: {g.leaders.length ? g.leaders.map((l) => `${l.name}${l.approved ? "" : " (not active)"}`).join(", ") : "none"}
                  </span>
                </p>
                {g.status === "active" && !g.leaders.some((l) => l.approved) ? (
                  <p className="text-sm font-semibold text-danger">No active leader. Appoint one from Manage.</p>
                ) : null}
              </div>
              <ArchiveGroupButton groupId={g.id} archived={g.status === "archived"} name={g.name} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No groups yet" action={<ButtonLink href="/admin/community/groups/new" size="sm">Create the first group</ButtonLink>} />
      )}
    </>
  );
}
