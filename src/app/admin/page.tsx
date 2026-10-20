import { CalendarClock, ChevronRight, CircleCheck, Hourglass, Megaphone, PencilLine, Settings, TimerOff, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { effectiveStatus } from "@/lib/announcements/status";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { displayName, requireAdminArea } from "@/lib/auth/viewer";
import { getChurchSettings, missingSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const viewer = await requireAdminArea();
  const supabase = await requireClient();
  const { settings } = await getChurchSettings();
  const can = (c: (typeof CAPABILITIES)[keyof typeof CAPABILITIES]) => viewer.capabilities.has(c);
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();

  const [pendingRes, announcementsRes] = await Promise.all([
    can(CAPABILITIES.membersView)
      ? supabase
          .from("profiles")
          .select("id, full_name, preferred_name, email, created_at", { count: "exact" })
          .eq("membership_status", "pending")
          .order("created_at", { ascending: true })
          .limit(5)
      : null,
    can(CAPABILITIES.announcementsManage)
      ? supabase
          .from("announcements")
          .select("id, title, status, publish_at, expires_at")
          .in("status", ["draft", "scheduled", "published"])
          .order("updated_at", { ascending: false })
          .limit(200)
      : null,
  ]);

  const loadFailed = Boolean(pendingRes?.error || announcementsRes?.error);
  const pending = pendingRes?.data ?? [];
  const pendingCount = pendingRes?.count ?? 0;
  const announcements = announcementsRes?.data ?? [];
  const scheduled = announcements
    .filter((a) => effectiveStatus(a, now) === "scheduled")
    .sort((a, b) => (a.publish_at ?? "").localeCompare(b.publish_at ?? ""))
    .slice(0, 5);
  const expiringSoon = announcements.filter((a) => effectiveStatus(a, now) === "live" && a.expires_at && a.expires_at <= weekAhead);
  const drafts = announcements.filter((a) => a.status === "draft");
  const missing = can(CAPABILITIES.settingsManage) ? missingSettings(settings) : [];

  return (
    <>
      <PageHeader eyebrow="Administration" title={`Welcome, ${displayName(viewer)}`} description="Here's what needs attention." />
      {loadFailed ? <Alert tone="error" title="Some dashboard information couldn't be loaded." className="mb-6" /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {can(CAPABILITIES.membersView) ? (
          <Card>
            <SectionHeading
              action={
                <Link href="/admin/members?status=pending" className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary hover:underline">
                  Review all <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              }
            >
              Waiting for approval
            </SectionHeading>
            {pendingCount ? (
              <>
                <p className="mb-3 flex items-center gap-2 font-semibold">
                  <Hourglass className="size-5 text-primary" aria-hidden="true" />
                  {pendingCount} {pendingCount === 1 ? "person is" : "people are"} waiting
                </p>
                <ul className="divide-y divide-border">
                  {pending.map((p) => (
                    <li key={p.id}>
                      <Link href={`/admin/members/${p.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 hover:underline">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{p.preferred_name || p.full_name || p.email}</span>
                          <span className="block truncate text-sm text-text-secondary">{p.email}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="flex items-center gap-2 text-text-secondary">
                <CircleCheck className="size-5 text-success" aria-hidden="true" />
                No one is waiting for approval.
              </p>
            )}
          </Card>
        ) : null}

        {can(CAPABILITIES.announcementsManage) ? (
          <Card>
            <SectionHeading action={<ButtonLink href="/admin/announcements/new" size="sm">New announcement</ButtonLink>}>
              Announcements
            </SectionHeading>
            <ul className="space-y-4">
              <li>
                <p className="flex items-center gap-2 font-semibold">
                  <CalendarClock className="size-5 text-primary" aria-hidden="true" />
                  Scheduled to publish
                </p>
                {scheduled.length ? (
                  <ul className="ml-7 mt-1 space-y-1">
                    {scheduled.map((a) => (
                      <li key={a.id}>
                        <Link href={`/admin/announcements/${a.id}`} className="font-semibold text-primary hover:underline">
                          {a.title}
                        </Link>
                        <span className="block text-sm text-text-secondary">{formatDateTime(a.publish_at!, settings.timezone)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ml-7 text-text-secondary">Nothing scheduled.</p>
                )}
              </li>
              <li>
                <p className="flex items-center gap-2 font-semibold">
                  <TimerOff className="size-5 text-primary" aria-hidden="true" />
                  Expiring in the next 7 days
                </p>
                {expiringSoon.length ? (
                  <ul className="ml-7 mt-1 space-y-1">
                    {expiringSoon.map((a) => (
                      <li key={a.id}>
                        <Link href={`/admin/announcements/${a.id}`} className="font-semibold text-primary hover:underline">
                          {a.title}
                        </Link>
                        <span className="block text-sm text-text-secondary">Ends {formatDateTime(a.expires_at!, settings.timezone)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ml-7 text-text-secondary">Nothing expiring soon.</p>
                )}
              </li>
              <li>
                <Link href="/admin/announcements?filter=draft" className="flex items-center gap-2 font-semibold hover:underline">
                  <PencilLine className="size-5 text-primary" aria-hidden="true" />
                  {drafts.length} {drafts.length === 1 ? "draft" : "drafts"} in progress
                </Link>
              </li>
            </ul>
          </Card>
        ) : null}

        {can(CAPABILITIES.settingsManage) ? (
          <Card>
            <SectionHeading action={<ButtonLink href="/admin/settings" size="sm" variant="secondary">Edit settings</ButtonLink>}>
              Church settings
            </SectionHeading>
            {missing.length ? (
              <>
                <p className="mb-2 flex items-center gap-2 font-semibold">
                  <Settings className="size-5 text-primary" aria-hidden="true" />
                  Not yet configured
                </p>
                <ul className="ml-7 list-disc space-y-0.5 pl-4 text-text-secondary">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-text-secondary">Visitors see a friendly placeholder until these are filled in.</p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-text-secondary">
                <CircleCheck className="size-5 text-success" aria-hidden="true" />
                All public church details are configured.
              </p>
            )}
          </Card>
        ) : null}

        {can(CAPABILITIES.rolesManage) ? (
          <Card>
            <SectionHeading>Team access</SectionHeading>
            <p className="text-text-secondary">
              Give trusted members a role such as membership administrator or content editor from their member page.
            </p>
            <Link href="/admin/members?status=approved" className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold text-primary hover:underline">
              <UserPlus className="size-5" aria-hidden="true" />
              Choose a member
            </Link>
          </Card>
        ) : null}

        {!can(CAPABILITIES.membersView) && !can(CAPABILITIES.announcementsManage) && !can(CAPABILITIES.settingsManage) ? (
          <Card>
            <p className="flex items-center gap-2 text-text-secondary">
              <Megaphone className="size-5" aria-hidden="true" />
              Use the menu to open the areas your role covers.
            </p>
          </Card>
        ) : null}
      </div>
      <p className="mt-8 text-meta text-text-secondary">
        Design system:{" "}
        <Link href="/design/icons" className="font-semibold text-primary hover:underline">
          icon reference
        </Link>
      </p>
    </>
  );
}
