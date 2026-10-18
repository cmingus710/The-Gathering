import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { MembershipBadge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { RoleControls, StatusControls } from "../member-controls";

export const metadata: Metadata = { title: "Member" };

export default async function MemberDetailPage({ params }: PageProps<"/admin/members/[id]">) {
  const { id } = await params;
  const viewer = await requireCapability(CAPABILITIES.membersView, `/admin/members/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await requireClient();
  const { settings } = await getChurchSettings();

  const [{ data: member }, { data: assigned }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, preferred_name, phone, membership_status, created_at, status_changed_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("user_roles").select("role_key").eq("user_id", id),
    supabase.from("roles").select("key, name, description, assignable, sort_order").eq("assignable", true).order("sort_order"),
  ]);
  if (!member) notFound();

  const name = member.preferred_name || member.full_name || member.email;
  const isSelf = member.id === viewer.id;
  const canManage = viewer.capabilities.has(CAPABILITIES.membersManage);
  const canRoles = viewer.capabilities.has(CAPABILITIES.rolesManage);

  return (
    <>
      <Link href="/admin/members" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Members
      </Link>
      <PageHeader title={name} description={member.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeading>Membership</SectionHeading>
          <dl className="mb-5 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold text-text-secondary">Status</dt>
              <dd className="mt-1">
                <MembershipBadge status={member.membership_status} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-text-secondary">Registered</dt>
              <dd>{formatDate(member.created_at, settings.timezone)}</dd>
            </div>
            {member.status_changed_at ? (
              <div>
                <dt className="text-sm font-semibold text-text-secondary">Status last changed</dt>
                <dd>{formatDateTime(member.status_changed_at, settings.timezone)}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-sm font-semibold text-text-secondary">Full name</dt>
              <dd>{member.full_name || "—"}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-text-secondary">Phone</dt>
              <dd>{member.phone || "—"}</dd>
            </div>
          </dl>
          {isSelf ? (
            <Alert tone="info" title="This is your own account." live={false}>
              You can&apos;t change your own membership status.
            </Alert>
          ) : canManage ? (
            <StatusControls userId={member.id} status={member.membership_status} name={name} />
          ) : (
            <p className="text-text-secondary">Your role can view members but not change their status.</p>
          )}
        </Card>

        {canRoles ? (
          <Card>
            <SectionHeading>Roles</SectionHeading>
            {member.membership_status !== "approved" ? (
              <Alert tone="info" title="Roles can be assigned after the member is approved." live={false} />
            ) : (
              <>
                <p className="mb-2 text-[0.95rem] text-text-secondary">
                  Roles grant administrative access. Membership status is separate: a suspended member loses all role access.
                </p>
                <RoleControls userId={member.id} roles={roles ?? []} assigned={(assigned ?? []).map((r) => r.role_key)} />
              </>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
