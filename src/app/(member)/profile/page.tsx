import { ChevronRight, Eye, ImageIcon, KeyRound, ShieldCheck, UserPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemeControl } from "@/components/theme/theme-control";
import { MemberAvatar } from "@/components/profile/member-avatar";
import { Alert } from "@/components/ui/alert";
import { Badge, MembershipBadge } from "@/components/ui/badge";
import { Card, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { signPhotoUrls } from "@/lib/profile/photos";
import { getMyHouseholdInvitations, getProfileDetails } from "@/lib/profile/queries";
import { requireClient } from "@/lib/supabase/server";
import { getThemePreference } from "@/lib/theme/server";

export const metadata: Metadata = { title: "Profile" };

const chevron = <ChevronRight className="size-5" aria-hidden="true" />;

export default async function ProfilePage() {
  const viewer = await requireApprovedMember("/profile");
  const supabase = await requireClient();
  const [{ data: roles }, details, invitations] = await Promise.all([
    supabase.from("user_roles").select("role_key, roles(name)").eq("user_id", viewer.id),
    getProfileDetails(supabase, viewer.id).catch(() => null),
    getMyHouseholdInvitations(supabase).catch(() => []),
  ]);
  const roleNames = (roles ?? []).map((r) => (r.roles as unknown as { name: string } | null)?.name ?? r.role_key);
  const photoUrl = details?.photo_path ? ((await signPhotoUrls(supabase, [details.photo_path])).get(details.photo_path) ?? null) : null;
  const name = displayName(viewer);

  return (
    <>
      <PageHeader title="Your profile" />
      <Card className="mb-6 flex items-center gap-4 sm:max-w-md">
        <MemberAvatar name={name} photoUrl={photoUrl} size="md" />
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-semibold">{name}</p>
          <p className="text-meta text-text-secondary">
            {details?.directory_listed === false ? "Hidden from the member directory" : "Listed in the member directory"}
          </p>
        </div>
      </Card>

      {invitations.length ? (
        <Alert tone="warning" title={invitations.length === 1 ? "You have a household invitation." : `You have ${invitations.length} household invitations.`} className="mb-6">
          <Link href="/profile/household" className="font-semibold text-primary underline underline-offset-2">
            Review invitations
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          <section aria-labelledby="profile-sections">
            <SectionHeading id="profile-sections">Profile and directory</SectionHeading>
            <ul className={rowListClass}>
              <li><ListRow plain href="/profile/edit" icon={<UserPen className="size-5" aria-hidden="true" />} label="Edit profile details" description="Name, contact details, address, birthday, interests" trailing={chevron} /></li>
              <li><ListRow plain href="/profile/photo" icon={<ImageIcon className="size-5" aria-hidden="true" />} label="Profile photo" description={details?.photo_path ? "Replace or remove your photo" : "Add a photo (optional)"} trailing={chevron} /></li>
              <li><ListRow plain href="/profile/privacy" icon={<ShieldCheck className="size-5" aria-hidden="true" />} label="Directory privacy" description="Choose what other members can see" trailing={chevron} /></li>
              <li><ListRow plain href="/profile/preview" icon={<Eye className="size-5" aria-hidden="true" />} label="Preview my directory profile" description="See exactly what other members see" trailing={chevron} /></li>
              <li><ListRow plain href="/profile/household" icon={<Icon name="home" className="size-5" />} label="Household" description="Connect with adults you live with" trailing={chevron} /></li>
            </ul>
          </section>
          <section aria-labelledby="profile-more">
            <SectionHeading id="profile-more">Giving and notifications</SectionHeading>
            <ul className={rowListClass}>
              <li><ListRow plain href="/giving" icon={<Icon name="giving" className="size-5" />} label="My giving" description="Gift history, recurring gifts, and statements" trailing={chevron} /></li>
              <li><ListRow plain href="/notifications/settings" icon={<Icon name="notifications" className="size-5" />} label="Notification settings" description="What reaches you, and how" trailing={chevron} /></li>
              {viewer.isAdmin ? (
                <li><ListRow plain href="/admin" icon={<Icon name="admin" className="size-5" />} label="Administration" description="Areas your role covers" trailing={chevron} /></li>
              ) : null}
            </ul>
          </section>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHeading as="h2">Account</SectionHeading>
            <dl className="space-y-3">
              <div>
                <dt className="text-meta font-semibold text-text-secondary">Sign-in email</dt>
                <dd className="break-all">{viewer.email}</dd>
                <dd className="text-meta text-text-secondary">Never shown in the directory.</dd>
              </div>
              <div>
                <dt className="text-meta font-semibold text-text-secondary">Membership</dt>
                <dd className="mt-1">
                  <MembershipBadge status={viewer.status} />
                </dd>
              </div>
              {roleNames.length ? (
                <div>
                  <dt className="text-meta font-semibold text-text-secondary">Roles</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {roleNames.map((r) => (
                      <Badge key={r}>{r}</Badge>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </Card>
          <Card>
            <ThemeControl current={await getThemePreference()} />
            <p className="mt-2 text-meta text-text-secondary">Saved on this device.</p>
          </Card>
          <Card>
            <SectionHeading as="h2">Security</SectionHeading>
            <Link href="/reset-password" className="flex min-h-11 items-center gap-3 rounded-control px-3 font-semibold text-primary hover:bg-primary-soft">
              <KeyRound className="size-5" aria-hidden="true" />
              Change password
            </Link>
            <SignOutButton />
          </Card>
        </div>
      </div>
    </>
  );
}
