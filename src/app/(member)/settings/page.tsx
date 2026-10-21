import { ChevronRight, Eye, ImageIcon, KeyRound, Mail, ShieldCheck, UserPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemeControl } from "@/components/theme/theme-control";
import { Badge, MembershipBadge } from "@/components/ui/badge";
import { Card, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { getPushConfig } from "@/lib/community/server";
import type { MySettings } from "@/lib/community/types";
import { getProfileDetails } from "@/lib/profile/queries";
import { requireClient } from "@/lib/supabase/server";
import { getThemePreference } from "@/lib/theme/server";
import { PushDevices } from "../notifications/notification-forms";
import { signInMethods } from "./sign-in-methods";

export const metadata: Metadata = { title: "Settings" };

const chevron = <ChevronRight className="size-5" aria-hidden="true" />;

/**
 * One place for a member's own settings. Everything here is the member's own
 * data or a link to the page that already edits it; roles and access are
 * shown read-only. Granting or removing roles stays in Administration →
 * Members, behind members.manage / roles.manage.
 */
export default async function SettingsPage() {
  const viewer = await requireApprovedMember("/settings");
  const supabase = await requireClient();
  const [{ data: auth }, { data: roles }, { data: catalog }, details, notify, theme] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("user_roles").select("role_key, roles(name, description)").eq("user_id", viewer.id),
    supabase.from("capabilities").select("key, description"),
    getProfileDetails(supabase, viewer.id).catch(() => null),
    tryCommunityRpc<MySettings>("community_my_settings"),
    getThemePreference(),
  ]);
  const push = getPushConfig();
  const methods = signInMethods(auth.user);
  const myRoles = (roles ?? []).map((r) => {
    const role = r.roles as unknown as { name: string; description: string } | null;
    return { key: r.role_key, name: role?.name ?? r.role_key, description: role?.description ?? "" };
  });
  const describe = new Map((catalog ?? []).map((c) => [c.key, c.description]));
  const access = [...viewer.capabilities].sort().map((key) => ({ key, description: describe.get(key) ?? key }));

  return (
    <>
      <PageHeader title="Settings" description={`Signed in as ${displayName(viewer)}.`} />
      <nav aria-label="Settings sections" className="mb-8 flex flex-wrap gap-2">
        {[
          ["#profile", "Profile"],
          ["#account", "Account and sign-in"],
          ["#notifications", "Notifications"],
          ["#appearance", "Appearance"],
          ["#privacy", "Directory and privacy"],
          ["#access", "Roles and access"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 font-semibold text-text-secondary hover:bg-surface-muted hover:text-text">
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-10">
        <section id="profile" aria-labelledby="settings-profile" className="scroll-mt-24">
          <SectionHeading id="settings-profile">Profile</SectionHeading>
          <ul className={rowListClass}>
            <li><ListRow plain href="/profile" icon={<Icon name="profile" className="size-5" />} label="Your profile" description="Overview, household, and giving" trailing={chevron} /></li>
            <li><ListRow plain href="/profile/edit" icon={<UserPen className="size-5" aria-hidden="true" />} label="Edit profile details" description="Name, contact details, address, birthday, interests" trailing={chevron} /></li>
            <li><ListRow plain href="/profile/photo" icon={<ImageIcon className="size-5" aria-hidden="true" />} label="Profile photo" description={details?.photo_path ? "Replace or remove your photo" : "Add a photo (optional)"} trailing={chevron} /></li>
          </ul>
        </section>

        <section id="account" aria-labelledby="settings-account" className="scroll-mt-24">
          <SectionHeading id="settings-account">Account and sign-in</SectionHeading>
          <Card>
            <dl className="space-y-3">
              <div>
                <dt className="text-meta text-text-secondary">Sign-in email</dt>
                <dd className="break-all font-semibold">{viewer.email}</dd>
              </div>
              <div>
                <dt className="text-meta text-text-secondary">Membership</dt>
                <dd className="mt-1"><MembershipBadge status={viewer.status} /></dd>
              </div>
              <div>
                <dt className="text-meta text-text-secondary">Ways you can sign in</dt>
                <dd>
                  <ul className="mt-1 space-y-1">
                    {methods.map((m) => (
                      <li key={m} className="flex items-center gap-2">
                        <Mail className="size-4 text-text-secondary" aria-hidden="true" />
                        {m}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-meta text-text-secondary">
              Your sign-in email is separate from the contact email other members may see. To change your sign-in email, ask a membership administrator.
            </p>
            <div className="mt-4 border-t border-border pt-3">
              <Link href="/reset-password" className="flex min-h-11 items-center gap-3 rounded-control px-3 font-semibold text-primary hover:bg-primary-soft">
                <KeyRound className="size-5" aria-hidden="true" />
                Change password
              </Link>
              <SignOutButton />
            </div>
          </Card>
        </section>

        <section id="notifications" aria-labelledby="settings-notifications" className="scroll-mt-24">
          <SectionHeading id="settings-notifications" description="What reaches you, where, and when.">
            Notifications
          </SectionHeading>
          <ul className={`${rowListClass} mb-4`}>
            <li><ListRow plain href="/notifications/settings" icon={<Icon name="notifications" className="size-5" />} label="Notification preferences" description="Categories, email, quiet hours, and muted items" trailing={chevron} /></li>
          </ul>
          <Card>
            <h3 className="mb-2 font-semibold">This device</h3>
            {notify ? (
              <PushDevices publicKey={push?.publicKey ?? null} devices={notify.push_devices} pushCategories={Object.values(notify.prefs).filter((p) => p?.push).length} />
            ) : (
              <p className="text-text-secondary">Device notification status couldn&apos;t be loaded right now.</p>
            )}
          </Card>
        </section>

        <section id="appearance" aria-labelledby="settings-appearance" className="scroll-mt-24">
          <SectionHeading id="settings-appearance">Appearance</SectionHeading>
          <Card>
            <ThemeControl current={theme} compact />
            <p className="mt-2 text-meta text-text-secondary">
              Saved on this device. System follows your phone or computer&apos;s light and dark setting, including when it changes.
            </p>
          </Card>
        </section>

        <section id="privacy" aria-labelledby="settings-privacy" className="scroll-mt-24">
          <SectionHeading id="settings-privacy" description={details?.directory_listed === false ? "You are hidden from the member directory." : "You are listed in the member directory."}>
            Directory and privacy
          </SectionHeading>
          <ul className={rowListClass}>
            <li><ListRow plain href="/profile/privacy" icon={<ShieldCheck className="size-5" aria-hidden="true" />} label="Directory privacy" description="Choose what other members can see" trailing={chevron} /></li>
            <li><ListRow plain href="/profile/preview" icon={<Eye className="size-5" aria-hidden="true" />} label="Preview my directory profile" description="See exactly what other members see" trailing={chevron} /></li>
          </ul>
        </section>

        <section id="access" aria-labelledby="settings-access" className="scroll-mt-24">
          <SectionHeading id="settings-access" description="Read-only. Roles are assigned by church administrators.">
            Roles and access
          </SectionHeading>
          <Card>
            {myRoles.length ? (
              <ul className="space-y-3">
                {myRoles.map((r) => (
                  <li key={r.key}>
                    <Badge tone="neutral">{r.name}</Badge>
                    {r.description ? <p className="mt-1 text-meta text-text-secondary">{r.description}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>You have member access: everything members can see and do. You don&apos;t hold any administrative roles.</p>
            )}
            {access.length ? (
              <details className="mt-4 border-t border-border pt-3">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">What these roles let you do</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-meta text-text-secondary">
                  {access.map((a) => (
                    <li key={a.key}>{a.description}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <p className="mt-4 text-meta text-text-secondary">
              You can&apos;t add or remove roles yourself. If something here looks wrong, or you need access for a ministry you serve in, ask a church administrator.
            </p>
            {viewer.isAdmin ? (
              <Link href="/admin" className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold text-primary hover:underline">
                <Icon name="admin" className="size-5" /> Open administration
              </Link>
            ) : null}
          </Card>
        </section>

        <section aria-label="Sign out" className="border-t border-border pt-6">
          <SignOutButton />
        </section>
      </div>
    </>
  );
}
