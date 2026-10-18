import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Badge, MembershipBadge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const viewer = await requireApprovedMember("/profile");
  const supabase = await requireClient();
  const { data: roles } = await supabase.from("user_roles").select("role_key, roles(name)").eq("user_id", viewer.id);
  const roleNames = (roles ?? []).map((r) => (r.roles as unknown as { name: string } | null)?.name ?? r.role_key);

  return (
    <>
      <PageHeader title="Your profile" description="Basic account details. More profile options arrive with the member directory." />
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <SectionHeading>Personal details</SectionHeading>
          <ProfileForm initial={{ fullName: viewer.fullName, preferredName: viewer.preferredName ?? "", phone: viewer.phone ?? "" }} />
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionHeading as="h2">Account</SectionHeading>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-semibold text-text-secondary">Email</dt>
                <dd className="break-all">{viewer.email}</dd>
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
