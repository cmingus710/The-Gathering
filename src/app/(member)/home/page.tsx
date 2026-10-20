import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { FeatureTileLink, type FeatureTile } from "@/components/home/feature-tile";
import { GatheringMotif } from "@/components/home/motif";
import { AnnouncementDigest, ComingLater, GatheringPanel, NextGatheringLine, UpcomingEventList } from "@/components/home/sections";
import { Icon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, SectionHeading, SectionLink } from "@/components/ui/card";
import { listLiveAnnouncements, type AnnouncementWithImage } from "@/lib/announcements/queries";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { signCoverUrls } from "@/lib/events/images";
import { listOccurrences } from "@/lib/events/queries";
import type { EventOccurrence } from "@/lib/events/types";
import { getGivingServer } from "@/lib/giving/server";
import { nextGathering } from "@/lib/home/next-gathering";
import { getMyHouseholdInvitations } from "@/lib/profile/queries";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Home" };

const NOTICES: Record<string, { tone: "success" | "error"; title: string }> = {
  "password-updated": { tone: "success", title: "Your password has been updated." },
  "not-authorized": { tone: "error", title: "You don't have access to that area." },
};

const EVENT_WINDOW_DAYS = 60;

export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const [viewer, { settings }, params] = await Promise.all([requireApprovedMember(), getChurchSettings(), searchParams]);
  const supabase = await requireClient();
  const now = new Date();
  const tz = settings.timezone;

  const [announcementsResult, eventsResult, invitations] = await Promise.all([
    listLiveAnnouncements(supabase, { limit: 3 }).then(
      (data): { ok: true; data: AnnouncementWithImage[] } => ({ ok: true, data }),
      () => ({ ok: false as const }),
    ),
    listOccurrences(supabase, now, new Date(now.getTime() + EVENT_WINDOW_DAYS * 86_400_000), { limit: 3 }),
    getMyHouseholdInvitations(supabase).catch(() => []),
  ]);
  const announcements = announcementsResult.ok ? announcementsResult.data : [];
  const events: EventOccurrence[] = eventsResult.ok ? eventsResult.data.slice(0, 3) : [];
  const covers = events[0]?.cover_path ? await signCoverUrls(supabase, [events[0].cover_path]) : new Map<string, string>();
  const coverUrl = events[0]?.cover_path ? (covers.get(events[0].cover_path) ?? null) : null;

  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = displayName(viewer).split(" ")[0];
  const today = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(now);
  const can = (c: (typeof CAPABILITIES)[keyof typeof CAPABILITIES]) => viewer.capabilities.has(c);

  // Implemented modules only; Give appears only when online giving is configured.
  const tiles: FeatureTile[] = [
    { key: "directory", href: "/directory", label: "Directory", hint: "Find your church family", icon: "directory" },
    { key: "events", href: "/events", label: "Events", hint: "See what's coming up", icon: "events" },
    { key: "community", href: "/community", label: "Community", hint: "Join the conversation", icon: "community" },
    { key: "messages", href: "/messages", label: "Messages", hint: "Private conversations", icon: "messages", count: "messages" },
    { key: "groups", href: "/groups", label: "Groups", hint: "Smaller circles to belong to", icon: "groups" },
    getGivingServer()
      ? { key: "give", href: "/give", label: "Give", hint: "Support the ministry", icon: "giving" }
      : { key: "announcements", href: "/announcements", label: "News", hint: "From the church", icon: "announcements" },
  ];

  return (
    <div className="layout-wide space-y-6 sm:space-y-8">
      {notice ? <Alert tone={notice.tone} title={notice.title} /> : null}

      <section
        aria-labelledby="home-welcome"
        className="relative overflow-hidden rounded-card border border-border bg-surface px-5 py-5 shadow-(--elev-card) sm:px-7 sm:py-7"
      >
        <GatheringMotif className="pointer-events-none absolute -right-20 -top-16 size-64 sm:-right-10 sm:-top-20 sm:size-80" />
        <span aria-hidden="true" className="absolute left-0 top-6 h-9 w-[3px] rounded-r-full bg-accent sm:top-8" />
        <div className="relative max-w-xl">
          <p className="text-meta font-semibold text-text-secondary">
            <time dateTime={now.toISOString()}>{today}</time>
          </p>
          <h1 id="home-welcome" className="mt-0.5 break-words font-display text-[1.875rem] font-semibold leading-[1.15] sm:text-[2.375rem]">
            {greeting}, {firstName}
          </h1>
          <NextGatheringLine next={nextGathering(settings.gatheringTimes, now, tz)} />
        </div>
      </section>

      <section aria-labelledby="home-quick">
        <h2 id="home-quick" className="sr-only">
          Quick access
        </h2>
        <ul className="grid grid-cols-3 gap-2 sm:gap-3">
          {tiles.map((t) => (
            <li key={t.key} className="min-w-0">
              <FeatureTileLink tile={t} />
            </li>
          ))}
        </ul>
      </section>

      {invitations.length ? (
        <ListRow
          href="/profile/household"
          icon={<Icon name="home" className="size-5" />}
          label={invitations.length === 1 ? "You have a household invitation" : `You have ${invitations.length} household invitations`}
          description="Review and accept or decline"
          trailing={<ChevronRight className="size-5" aria-hidden="true" />}
        />
      ) : null}

      <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6 sm:space-y-8">
          <section aria-labelledby="home-events">
            <SectionHeading id="home-events" action={events.length ? <SectionLink href="/events" label="View all events">View all</SectionLink> : null}>
              Upcoming events
            </SectionHeading>
            {!eventsResult.ok ? (
              <Alert tone="error" title="Events couldn't be loaded right now." />
            ) : events.length ? (
              <UpcomingEventList events={events} coverUrl={coverUrl} now={now} />
            ) : (
              <EmptyState
                glyph="events"
                title="No upcoming events"
                action={
                  can(CAPABILITIES.eventsManage) ? (
                    <ButtonLink href="/admin/events/new" variant="secondary" size="sm">
                      Create an event
                    </ButtonLink>
                  ) : null
                }
              >
                New events will appear here.
              </EmptyState>
            )}
          </section>

          <section aria-labelledby="home-announcements">
            <SectionHeading
              id="home-announcements"
              action={announcements.length ? <SectionLink href="/announcements" label="View all announcements">View all</SectionLink> : null}
            >
              Announcements
            </SectionHeading>
            {!announcementsResult.ok ? (
              <Alert tone="error" title="Announcements couldn't be loaded right now." />
            ) : announcements.length ? (
              <AnnouncementDigest items={announcements} timeZone={tz} />
            ) : (
              <EmptyState
                glyph="announcements"
                title="No announcements yet"
                action={
                  can(CAPABILITIES.announcementsManage) ? (
                    <ButtonLink href="/admin/announcements/new" variant="secondary" size="sm">
                      Post an announcement
                    </ButtonLink>
                  ) : null
                }
              >
                News from the church will appear here.
              </EmptyState>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6" aria-label="Church information">
          <GatheringPanel
            settings={settings}
            emptyAction={
              can(CAPABILITIES.settingsManage) ? (
                <ButtonLink href="/admin/settings" variant="secondary" size="sm">
                  Add gathering times
                </ButtonLink>
              ) : null
            }
          />
          <ComingLater />
        </aside>
      </div>
    </div>
  );
}
