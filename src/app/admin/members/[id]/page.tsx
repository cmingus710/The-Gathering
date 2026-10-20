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
import { MemberAvatar } from "@/components/profile/member-avatar";
import { signPhotoUrls } from "@/lib/profile/photos";
import { getProfileDetails, splitFullName } from "@/lib/profile/queries";
import { DirectoryBadge } from "../directory-badge";
import { RoleControls, StatusControls } from "../member-controls";
import { EligibilityForm } from "../../community/community-forms";
import { AdminProfileForm } from "./admin-profile-form";

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
      .select("id, email, full_name, first_name, last_name, preferred_name, phone, membership_status, account_kind, created_at, status_changed_at")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("user_roles").select("role_key").eq("user_id", id),
    supabase.from("roles").select("key, name, description, assignable, sort_order").eq("assignable", true).order("sort_order"),
  ]);
  if (!member) notFound();
  const canManageProfile = viewer.capabilities.has(CAPABILITIES.membersManage);
  // Private details: only for membership managers (RLS enforces the same).
  const details = canManageProfile ? await getProfileDetails(supabase, member.id).catch(() => null) : null;
  const photoUrl = details?.photo_path ? ((await signPhotoUrls(supabase, [details.photo_path])).get(details.photo_path) ?? null) : null;
  const split = splitFullName(member.full_name ?? "");

  const name = member.preferred_name || member.full_name || member.email;
  const isSelf = member.id === viewer.id;
  const canManage = viewer.capabilities.has(CAPABILITIES.membersManage);
  const canRoles = viewer.capabilities.has(CAPABILITIES.rolesManage);
  const eligibility = canManage
    ? ((await supabase.rpc("community_admin_dm_eligibility", { p_profile: id })).data as {
        eligible: boolean;
        decided_at: string | null;
        decided_by: string | null;
        note: string | null;
      } | null)
    : null;

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
                {member.account_kind === "youth" ? (
                  <span className="ml-2 text-meta text-text-secondary">Youth account: activated and reinstated only under Youth &amp; families. Roles can&apos;t be assigned.</span>
                ) : null}
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
                <p className="mb-2 text-meta text-text-secondary">
                  Roles grant administrative access. Membership status is separate: a suspended member loses all role access.
                </p>
                <RoleControls userId={member.id} roles={roles ?? []} assigned={(assigned ?? []).map((r) => r.role_key)} />
              </>
            )}
          </Card>
        ) : null}
      </div>

      {canManage && eligibility ? (
        <Card className="mt-6">
          <SectionHeading>Direct messaging</SectionHeading>
          <p className="mb-2">
            {eligibility.eligible ? "On." : "Off."}{" "}
            {eligibility.decided_at ? (
              <span className="text-text-secondary">
                Last changed {formatDateTime(eligibility.decided_at, settings.timezone)} by {eligibility.decided_by ?? "a former administrator"}
                {eligibility.note ? ` (${eligibility.note})` : ""}.
              </span>
            ) : (
              <span className="text-text-secondary">No decision recorded, so messaging is off.</span>
            )}
          </p>
          <p className="mb-4 text-meta text-text-secondary">
            Messaging is for adults only and stays off until a membership administrator confirms it here. Every change is recorded in the audit log. You can&apos;t
            change your own.
          </p>
          {isSelf ? null : member.membership_status !== "approved" && !eligibility.eligible ? (
            <Alert tone="info" title="Messaging can be turned on after the member is approved." live={false} />
          ) : (
            <EligibilityForm profileId={member.id} eligible={eligibility.eligible} />
          )}
        </Card>
      ) : null}

      {canManageProfile ? (
        <Card className="mt-6">
          <SectionHeading>Profile details</SectionHeading>
          {!details ? (
            <Alert tone="error" title="Profile details couldn't be loaded." />
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center gap-4">
                <MemberAvatar name={name} photoUrl={photoUrl} size="md" />
                <div className="space-y-1">
                  <DirectoryBadge status={member.membership_status} listed={details.directory_listed} />
                  {member.membership_status !== "approved" ? (
                    <p className="text-meta text-text-secondary">Not shown in the directory until approved.</p>
                  ) : null}
                  <p className="text-meta text-text-secondary">
                    Shares:{" "}
                    {[
                      details.show_photo && "photo",
                      details.show_city_state && "city/state",
                      details.show_ministry_interests && "interests",
                      details.show_household && "household",
                      details.show_phone && "phone",
                      details.show_contact_email && "directory email",
                      details.show_street_address && "street address",
                      details.show_birthday && "birthday",
                    ]
                      .filter(Boolean)
                      .join(", ") || "nothing beyond their name"}
                    . Privacy choices belong to the member and can&apos;t be changed here.
                  </p>
                </div>
              </div>
              <AdminProfileForm
                userId={member.id}
                isSelf={isSelf}
                hasPhoto={!!details.photo_path}
                initial={{
                  firstName: member.first_name ?? split.first,
                  lastName: member.last_name ?? (member.first_name ? "" : split.last),
                  preferredName: member.preferred_name ?? "",
                  phone: member.phone ?? "",
                  contactEmail: details.contact_email ?? "",
                  streetAddress: details.street_address ?? "",
                  city: details.city ?? "",
                  stateRegion: details.state_region ?? "",
                  postalCode: details.postal_code ?? "",
                  bio: details.bio ?? "",
                  birthdayMonth: details.birthday_month ? String(details.birthday_month) : "",
                  birthdayDay: details.birthday_day ? String(details.birthday_day) : "",
                }}
              />
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}
