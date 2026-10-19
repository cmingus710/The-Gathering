import { ChevronRight, Eye, HandCoins, Home, ImageIcon, KeyRound, ShieldCheck, UserPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { MemberAvatar } from "@/components/profile/member-avatar";
import { Alert } from "@/components/ui/alert";
import { Badge, MembershipBadge } from "@/components/ui/badge";
import { Card, ListRow, PageHeader, SectionHeading } from "@/components/ui/card";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { signPhotoUrls } from "@/lib/profile/photos";
import { getMyHouseholdInvitations, getProfileDetails } from "@/lib/profile/queries";
import { requireClient } from "@/lib/supabase/server";

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
      <Card className="mb-6 flex items-center gap-4">
        <MemberAvatar name={name} photoUrl={photoUrl} size="md" />
        <div className="min-w-0">
          <p className="truncate text-xl font-bold">{name}</p>
          <p className="text-[0.95rem] text-text-secondary">
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

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section aria-labelledby="profile-sections" className="space-y-2">
          <h2 id="profile-sections" className="sr-only">
            Profile settings
          </h2>
          <ListRow href="/profile/edit" icon={<UserPen className="size-6" aria-hidden="true" />} label="Edit profile details" description="Name, contact details, address, birthday, interests" trailing={chevron} />
          <ListRow href="/profile/photo" icon={<ImageIcon className="size-6" aria-hidden="true" />} label="Profile photo" description={details?.photo_path ? "Replace or remove your photo" : "Add a photo (optional)"} trailing={chevron} />
          <ListRow href="/profile/privacy" icon={<ShieldCheck className="size-6" aria-hidden="true" />} label="Directory privacy" description="Choose what other members can see" trailing={chevron} />
          <ListRow href="/profile/preview" icon={<Eye className="size-6" aria-hidden="true" />} label="Preview my directory profile" description="See exactly what other members see" trailing={chevron} />
          <ListRow href="/profile/household" icon={<Home className="size-6" aria-hidden="true" />} label="Household" description="Connect with adults you live with" trailing={chevron} />
          <ListRow href="/giving" icon={<HandCoins className="size-6" aria-hidden="true" />} label="My giving" description="Gift history, recurring gifts, and statements" trailing={chevron} />
        </section>

        <div className="space-y-6">
          <Card>
            <SectionHeading as="h2">Account</SectionHeading>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-semibold text-text-secondary">Sign-in email</dt>
                <dd className="break-all">{viewer.email}</dd>
                <dd className="text-sm text-text-secondary">Never shown in the directory.</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-text-secondary">Membership</dt>
                <dd className="mt-1">
                  <MembershipBadge status={viewer.status} />
                </dd>
              </div>
              {roleNames.length ? (
                <div>
                  <dt className="text-sm font-semibold text-text-secondary">Roles</dt>
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
