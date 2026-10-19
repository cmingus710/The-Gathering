import { CalendarClock, ChevronRight, Megaphone, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AnnouncementTile } from "@/components/announcements/announcement-card";
import { NavIcon } from "@/components/layout/nav-icon";
import { Alert } from "@/components/ui/alert";
import { SoonPill } from "@/components/ui/badge";
import { EmptyState, ListRow, SectionHeading, SectionLink } from "@/components/ui/card";
import { listLiveAnnouncements, type AnnouncementWithImage } from "@/lib/announcements/queries";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { MEMBER_NAV } from "@/lib/navigation";
import { getChurchSettings } from "@/lib/settings/queries";
import { WEEKDAY_LABEL } from "@/lib/settings/schema";
import { requireClient } from "@/lib/supabase/server";
import { formatClockTime, formatDayStamp } from "@/lib/time";

export const metadata: Metadata = { title: "Home" };

const NOTICES: Record<string, { tone: "success" | "error"; title: string }> = {
  "password-updated": { tone: "success", title: "Your password has been updated." },
  "not-authorized": { tone: "error", title: "You don't have access to that area." },
};

const upcoming = MEMBER_NAV.filter((i) => i.status === "upcoming");

export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const [viewer, { settings }, params] = await Promise.all([requireApprovedMember(), getChurchSettings(), searchParams]);
  const supabase = await requireClient();
  let announcements: AnnouncementWithImage[] = [];
  let failed = false;
  try {
    announcements = await listLiveAnnouncements(supabase, { limit: 8 });
  } catch {
    failed = true;
  }
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: settings.timezone }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = displayName(viewer).split(" ")[0];

  return (
    <div className="space-y-9">
      <Link
        href="/announcements"
        className="inline-flex min-h-11 items-center text-sm font-bold uppercase tracking-[0.08em] text-primary hover:text-primary-hover"
      >
        View all announcements
      </Link>

      {notice ? <Alert tone={notice.tone} title={notice.title} /> : null}

      <header className="-mt-4">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-text-secondary">{formatDayStamp(now, settings.timezone)}</p>
        <h1 className="mt-1 text-[1.75rem] font-bold leading-tight sm:text-[2rem]">
          {greeting}, {firstName}
        </h1>
      </header>

      {viewer.isAdmin ? (
        <ListRow
          href="/admin"
          icon={<ShieldCheck className="size-6 text-primary" aria-hidden="true" />}
          label="Administration"
          description="Members, announcements, and church settings"
          trailing={<ChevronRight className="size-5" aria-hidden="true" />}
        />
      ) : null}

      <section aria-labelledby="home-gatherings">
        <SectionHeading id="home-gatherings">Gathering times</SectionHeading>
        {settings.gatheringTimes.length ? (
          <ul className="space-y-3">
            {settings.gatheringTimes.map((g, i) => (
              <li key={`${g.label}-${i}`}>
                <ListRow
                  icon={<CalendarClock className="size-6" aria-hidden="true" />}
                  label={g.label}
                  description={g.location ?? undefined}
                  trailing={`${WEEKDAY_LABEL[g.day].slice(0, 3)} · ${formatClockTime(g.time)}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <ListRow
            icon={<CalendarClock className="size-6 text-text-secondary" aria-hidden="true" />}
            label="Gathering times will be posted soon"
          />
        )}
      </section>

      <section aria-labelledby="home-announcements">
        <SectionHeading id="home-announcements" action={<SectionLink href="/announcements">View all</SectionLink>}>
          Announcements
        </SectionHeading>
        {failed ? (
          <Alert tone="error" title="Announcements couldn't be loaded right now." />
        ) : announcements.length ? (
          <div className="rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
            {announcements.map((a) => (
              <AnnouncementTile key={a.id} announcement={a} timeZone={settings.timezone} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Megaphone className="size-8" aria-hidden="true" />} title="No announcements yet">
            New announcements will appear here.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="home-soon">
        <SectionHeading id="home-soon">Coming soon</SectionHeading>
        <ul className="space-y-3">
          {upcoming.map((item) => (
            <li key={item.key}>
              <ListRow
                icon={<NavIcon name={item.icon} className="size-6" />}
                label={item.label}
                trailing={
                  <>
                    <SoonPill />
                    <span className="sr-only">(not available yet)</span>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
