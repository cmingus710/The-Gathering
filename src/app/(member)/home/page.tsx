import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { Launcher, type LauncherTile } from "@/components/home/launcher";
import { TeachingSection, type HomeTeaching } from "@/components/home/teaching";
import { ComingUpBanner, ComingUpEmpty, GatheringPanel, GreetingBanner, HeadingLink, HomeSectionHeading, LifeAtGathering } from "@/components/home/sections";
import { Icon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow } from "@/components/ui/card";
import { listLiveAnnouncements, type AnnouncementWithImage } from "@/lib/announcements/queries";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireApprovedMember, type Viewer } from "@/lib/auth/viewer";
import { signCoverUrls } from "@/lib/events/images";
import { listOccurrences } from "@/lib/events/queries";
import { getGivingServer } from "@/lib/giving/server";
import { bannerCandidates, comingUpDate, nextComingUp, pickBanner, type DefaultBanner } from "@/lib/home/coming-up";
import { launcherItemsFor, menuArtSource } from "@/lib/home/launcher";
import { nextGathering } from "@/lib/home/next-gathering";
import { getMyHouseholdInvitations } from "@/lib/profile/queries";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Home" };

const NOTICES: Record<string, { tone: "success" | "error"; title: string }> = {
  "password-updated": { tone: "success", title: "Your password has been updated." },
  "not-authorized": { tone: "error", title: "You don't have access to that area." },
};

/** How far ahead "Coming up" looks, and how many dates it reads to skip canceled ones. */
const EVENT_WINDOW_DAYS = 120;
const EVENT_LOOKAHEAD = 12;

/** The name members chose to be called by; otherwise their first name. */
function greetingName(viewer: Pick<Viewer, "preferredName" | "fullName" | "email">): string {
  return viewer.preferredName?.trim() || viewer.fullName.trim().split(/\s+/)[0] || viewer.email.split("@")[0];
}

export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const [viewer, { settings }, params] = await Promise.all([requireApprovedMember(), getChurchSettings(), searchParams]);
  const supabase = await requireClient();
  const now = new Date();
  const tz = settings.timezone;

  const [announcementsResult, eventsResult, invitations, defaultBanner, teaching] = await Promise.all([
    listLiveAnnouncements(supabase, { limit: 3 }).then(
      (data): { ok: true; data: AnnouncementWithImage[] } => ({ ok: true, data }),
      () => ({ ok: false as const }),
    ),
    listOccurrences(supabase, now, new Date(now.getTime() + EVENT_WINDOW_DAYS * 86_400_000), { limit: EVENT_LOOKAHEAD }),
    getMyHouseholdInvitations(supabase).catch(() => []),
    // Null until an editor sets one (or before the banner migration is applied).
    Promise.resolve(supabase.rpc("events_home_banner_default")).then(
      ({ data, error }) => (error ? null : (data as DefaultBanner)),
      () => null,
    ),
    // Today's devotional, latest lesson, featured podcast, current reading; skipped on any error.
    Promise.resolve(supabase.rpc("media_home")).then(
      ({ data, error }) => (error || !data ? null : (data as HomeTeaching)),
      () => null,
    ),
  ]);
  const announcements = announcementsResult.ok ? announcementsResult.data : [];
  const event = eventsResult.ok ? nextComingUp(eventsResult.data, now) : null;

  // Fallback order: event banner → cover → church default → branded background.
  // Signing goes through Storage RLS, so a candidate the viewer can't see is skipped.
  const candidates = event ? bannerCandidates(event, defaultBanner) : [];
  const signed = candidates.length ? await signCoverUrls(supabase, candidates.map((c) => c.path)) : new Map<string, string>();
  const banner = pickBanner(candidates, signed);

  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(now);
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const can = (c: (typeof CAPABILITIES)[keyof typeof CAPABILITIES]) => viewer.capabilities.has(c);

  const tiles: LauncherTile[] = launcherItemsFor({ capabilities: viewer.capabilities, features: { giving: getGivingServer() !== null } }).map((i) => ({
    id: i.id,
    label: i.label,
    href: i.href,
    glyph: i.glyph,
    count: i.count,
    art: menuArtSource(i.art),
  }));

  return (
    <div className="layout-wide space-y-6 sm:space-y-8">
      {notice ? <Alert tone={notice.tone} title={notice.title} /> : null}

      <GreetingBanner dateLabel={today} dateTime={todayYmd} greeting={greeting} name={greetingName(viewer)} emblemSrc={settings.iconUrl} />

      <section aria-labelledby="home-menu">
        <h2 id="home-menu" className="sr-only">
          Main menu
        </h2>
        <Launcher tiles={tiles} labelledBy="home-menu" />
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

      {/* Phones: Coming up, Life at, Gathering times. Desktop: Life at in its own column. */}
      <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-start">
        <section aria-labelledby="home-coming-up" className="min-w-0 lg:col-start-1 lg:row-start-1">
          <HomeSectionHeading id="home-coming-up" action={eventsResult.ok ? <HeadingLink href="/events" label="View all events">View all</HeadingLink> : null}>
            Coming up
          </HomeSectionHeading>
          {!eventsResult.ok ? (
            <Alert tone="error" title="Events couldn't be loaded right now." />
          ) : event ? (
            <ComingUpBanner
              o={event}
              date={comingUpDate(event, now)}
              image={banner ? { url: banner.url, alt: banner.alt, focusX: banner.focusX, focusY: banner.focusY } : null}
              emblemSrc={settings.iconUrl}
            />
          ) : (
            <ComingUpEmpty
              emblemSrc={settings.iconUrl}
              action={
                can(CAPABILITIES.eventsManage) ? (
                  <ButtonLink href="/admin/events/new" variant="secondary" size="sm">
                    Create an event
                  </ButtonLink>
                ) : null
              }
            />
          )}
        </section>

        <section aria-labelledby="home-life" className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <HomeSectionHeading id="home-life" action={announcements.length ? <HeadingLink href="/announcements" label="All announcements" /> : null}>
            Life at {settings.churchName}
          </HomeSectionHeading>
          {!announcementsResult.ok ? (
            <Alert tone="error" title="Announcements couldn't be loaded right now." />
          ) : announcements.length ? (
            <LifeAtGathering items={announcements} timeZone={tz} />
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

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <GatheringPanel
            settings={settings}
            next={nextGathering(settings.gatheringTimes, now, tz)}
            emptyAction={
              can(CAPABILITIES.settingsManage) ? (
                <ButtonLink href="/admin/settings" variant="secondary" size="sm">
                  Add gathering times
                </ButtonLink>
              ) : null
            }
          />
        </div>
      </div>

      {teaching ? <TeachingSection data={teaching} /> : null}
    </div>
  );
}
