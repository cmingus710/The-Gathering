import { AtSign, Bell, BookMarked, BookOpen, BookOpenCheck, CalendarDays, HandHeart, HandHelping, Images, MessageCircle, MessagesSquare, Settings, ShieldAlert, Sprout, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiveRefresh } from "@/components/community/live-refresh";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { NotificationItem } from "@/lib/community/types";
import { MarkReadButton } from "./notification-forms";

export const metadata: Metadata = { title: "Notifications" };

const ICON = {
  forum: MessagesSquare,
  groups: UsersRound,
  messages: MessageCircle,
  moderation: ShieldAlert,
  events: CalendarDays,
  prayer: HandHeart,
  care: HandHelping,
  teaching: BookOpen,
  gallery: Images,
  reading: BookOpenCheck,
  memory: BookMarked,
  youth: Sprout,
  mentions: AtSign,
} as const;

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  await requireApprovedMember("/notifications");
  const sp = await searchParams;
  const before = typeof sp.before === "string" && !Number.isNaN(Date.parse(sp.before)) ? sp.before : null;
  const data = await tryCommunityRpc<{ items: NotificationItem[]; has_more: boolean }>("community_notifications", { p_before: before, p_limit: 30 });
  const unread = data?.items.filter((n) => !n.read).length ?? 0;
  return (
    <>
      <LiveRefresh />
      <PageHeader
        title="Notifications"
        description="Only what you can still see is listed. Giving records never appear here."
        actions={
          <>
            {unread ? <MarkReadButton label="Mark all as read" /> : null}
            <ButtonLink href="/notifications/settings" variant="secondary" size="sm" icon={<Settings className="size-4" aria-hidden="true" />}>
              Settings
            </ButtonLink>
          </>
        }
      />
      {sp.gone ? <Alert tone="info" title="That's no longer available." className="mb-6">It may have been removed, or you may no longer have access to it.</Alert> : null}
      {!data ? (
        <Alert tone="error" title="Notifications couldn't be loaded right now." />
      ) : data.items.length ? (
        <>
          <ul className="space-y-2">
            {data.items.map((n) => {
              const Icon = ICON[n.category] ?? Bell;
              return (
                <li key={n.id} className={`flex items-start gap-3 rounded-card px-4 py-3 ${n.read ? "bg-surface" : "bg-surface-muted ring-1 ring-primary/40"}`}>
                  <Icon className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/notifications/open/${n.id}`} prefetch={false} className="font-semibold hover:underline">
                      {!n.read ? <span className="mr-2 inline-block rounded-md bg-cta px-1.5 text-[0.8125rem] font-semibold text-on-cta">New</span> : null}
                      {n.title}
                    </Link>
                    {n.reason ? <p className="text-meta text-text-secondary">Reason: {n.reason}</p> : null}
                    <p className="text-sm text-text-secondary">
                      <time dateTime={n.created_at}>{relativeTime(n.created_at)}</time>
                    </p>
                  </div>
                  {!n.read ? <MarkReadButton id={n.id} label="Mark read" /> : null}
                </li>
              );
            })}
          </ul>
          {data.has_more ? (
            <div className="mt-6">
              <ButtonLink href={`/notifications?before=${encodeURIComponent(data.items[data.items.length - 1].created_at)}`} variant="secondary" size="sm">
                Older notifications
              </ButtonLink>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={<Bell className="size-6" aria-hidden="true" />} title={before ? "No older notifications" : "You're all caught up"} />
      )}
    </>
  );
}
