import { CalendarClock, ChevronRight, Megaphone, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AnnouncementCard } from "@/components/announcements/announcement-card";
import { Alert } from "@/components/ui/alert";
import { Card, EmptyState, SectionHeading } from "@/components/ui/card";
import { listLiveAnnouncements, type AnnouncementWithImage } from "@/lib/announcements/queries";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { WEEKDAY_LABEL } from "@/lib/settings/schema";
import { requireClient } from "@/lib/supabase/server";
import { formatClockTime } from "@/lib/time";

export const metadata: Metadata = { title: "Home" };

const NOTICES: Record<string, { tone: "success" | "error"; title: string }> = {
  "password-updated": { tone: "success", title: "Your password has been updated." },
  "not-authorized": { tone: "error", title: "You don't have access to that area." },
};

export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const [viewer, { settings }, params] = await Promise.all([requireApprovedMember(), getChurchSettings(), searchParams]);
  const supabase = await requireClient();
  let announcements: AnnouncementWithImage[] = [];
  let failed = false;
  try {
    announcements = await listLiveAnnouncements(supabase, { limit: 4 });
  } catch {
    failed = true;
  }
  const notice = typeof params.notice === "string" ? NOTICES[params.notice] : undefined;
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: settings.timezone }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-8">
      {notice ? <Alert tone={notice.tone} title={notice.title} /> : null}
      <header>
        <p className="text-text-secondary">{greeting},</p>
        <h1 className="font-serif text-[2rem] font-semibold leading-tight sm:text-[2.4rem]">{displayName(viewer)}</h1>
        <div aria-hidden="true" className="mt-3 h-[3px] w-12 rounded-full bg-brand-gold" />
      </header>

      {viewer.isAdmin ? (
        <Link
          href="/admin"
          className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-3 font-semibold hover:bg-primary-soft"
        >
          <span className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Open administration
          </span>
          <ChevronRight className="size-5" aria-hidden="true" />
        </Link>
      ) : null}

      <section aria-labelledby="home-announcements">
        <SectionHeading
          id="home-announcements"
          action={
            <Link href="/announcements" className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline">
              All announcements <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          }
        >
          Latest announcements
        </SectionHeading>
        {failed ? (
          <Alert tone="error" title="Announcements couldn't be loaded right now." />
        ) : announcements.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {announcements.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} timeZone={settings.timezone} href={`/announcements/${a.id}`} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Megaphone className="size-5" aria-hidden="true" />} title="No announcements yet">
            New announcements will appear here.
          </EmptyState>
        )}
      </section>

      <Card>
        <SectionHeading>Gathering times</SectionHeading>
        {settings.gatheringTimes.length ? (
          <ul className="space-y-3">
            {settings.gatheringTimes.map((g, i) => (
              <li key={`${g.label}-${i}`} className="flex gap-3">
                <CalendarClock className="mt-1 size-5 shrink-0 text-brand-gold" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{g.label}</span>
                  <span className="block text-text-secondary">
                    {WEEKDAY_LABEL[g.day]}s at {formatClockTime(g.time)}
                    {g.location ? ` · ${g.location}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-secondary">Gathering times haven&apos;t been posted yet.</p>
        )}
      </Card>
    </div>
  );
}
