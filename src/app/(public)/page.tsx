import { CalendarClock, Mail, MapPin, Megaphone, Phone } from "lucide-react";
import Link from "next/link";
import { AnnouncementCard } from "@/components/announcements/announcement-card";
import { FullLogo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, SectionHeading } from "@/components/ui/card";
import { listLiveAnnouncements, type AnnouncementWithImage } from "@/lib/announcements/queries";
import { getViewer } from "@/lib/auth/viewer";
import { getChurchSettings, hasAddress } from "@/lib/settings/queries";
import { SOCIAL_LABEL, SOCIAL_NETWORKS, WEEKDAY_LABEL } from "@/lib/settings/schema";
import { createClient } from "@/lib/supabase/server";
import { formatClockTime, timeZoneLabel } from "@/lib/time";

export default async function WelcomePage() {
  const [{ settings, available }, viewer] = await Promise.all([getChurchSettings(), getViewer()]);

  let announcements: AnnouncementWithImage[] = [];
  let announcementsFailed = false;
  const supabase = await createClient();
  if (supabase) {
    try {
      announcements = await listLiveAnnouncements(supabase, { limit: 3, audience: "public" });
    } catch {
      announcementsFailed = true;
    }
  }
  const signedIn = viewer.state === "signed-in";
  const social = SOCIAL_NETWORKS.filter((n) => settings.socialLinks[n]);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6">
      <section className="flex flex-col items-center py-10 text-center sm:py-14" aria-labelledby="welcome-heading">
        <FullLogo src={settings.logoUrl} alt={settings.churchName} className="w-56 sm:w-72" priority />
        <h1 id="welcome-heading" className="sr-only">
          Welcome to {settings.churchName}
        </h1>
        <div className="mt-8 max-w-xl">
          {settings.description ? (
            <p className="whitespace-pre-line text-lg leading-relaxed">{settings.description}</p>
          ) : (
            <p className="text-lg leading-relaxed text-text-secondary">Welcome. We&apos;re glad you&apos;re here.</p>
          )}
        </div>
        <div className="mt-8 flex w-full max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          {signedIn ? (
            <ButtonLink href="/home">Open the app</ButtonLink>
          ) : (
            <>
              <ButtonLink href="/sign-in">Sign in</ButtonLink>
              <ButtonLink href="/sign-up" variant="secondary">
                Create an account
              </ButtonLink>
            </>
          )}
        </div>
        {!available ? (
          <div className="mt-8 w-full max-w-xl text-left">
            <Alert tone="warning" title="Some information is temporarily unavailable">
              Church details couldn&apos;t be loaded right now. Please try again later.
            </Alert>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 pb-14 md:grid-cols-2">
        <Card>
          <SectionHeading>Gather with us</SectionHeading>
          {settings.gatheringTimes.length ? (
            <>
              <ul className="space-y-3">
                {settings.gatheringTimes.map((g, i) => (
                  <li key={`${g.label}-${i}`} className="flex gap-3">
                    <CalendarClock className="mt-1 size-5 shrink-0 text-brand-gold" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">{g.label}</p>
                      <p className="text-text-secondary">
                        {WEEKDAY_LABEL[g.day]}s at {formatClockTime(g.time)}
                        {g.location ? ` · ${g.location}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-text-secondary">Times shown in {timeZoneLabel(settings.timezone)}.</p>
            </>
          ) : (
            <p className="text-text-secondary">Gathering times will be posted here soon.</p>
          )}
        </Card>

        <Card>
          <SectionHeading>Find us</SectionHeading>
          {hasAddress(settings) || settings.contactEmail || settings.contactPhone ? (
            <ul className="space-y-3">
              {hasAddress(settings) ? (
                <li className="flex gap-3">
                  <MapPin className="mt-1 size-5 shrink-0 text-brand-gold" aria-hidden="true" />
                  <address className="not-italic">
                    {[settings.address.line1, settings.address.line2].filter(Boolean).map((l) => (
                      <span key={l} className="block">
                        {l}
                      </span>
                    ))}
                    <span className="block">
                      {[settings.address.city, settings.address.region].filter(Boolean).join(", ")} {settings.address.postalCode}
                    </span>
                  </address>
                </li>
              ) : null}
              {settings.contactEmail ? (
                <li className="flex gap-3">
                  <Mail className="mt-1 size-5 shrink-0 text-brand-gold" aria-hidden="true" />
                  <a href={`mailto:${settings.contactEmail}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                    {settings.contactEmail}
                  </a>
                </li>
              ) : null}
              {settings.contactPhone ? (
                <li className="flex gap-3">
                  <Phone className="mt-1 size-5 shrink-0 text-brand-gold" aria-hidden="true" />
                  <a href={`tel:${settings.contactPhone.replace(/[^0-9+]/g, "")}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                    {settings.contactPhone}
                  </a>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-text-secondary">Contact details will be posted here soon.</p>
          )}
          {social.length ? (
            <ul className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4" aria-label="Social links">
              {social.map((n) => (
                <li key={n}>
                  <a
                    href={settings.socialLinks[n]}
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center rounded-full border border-border-strong px-4 font-semibold hover:bg-primary-soft"
                  >
                    {SOCIAL_LABEL[n]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <section className="md:col-span-2" aria-labelledby="public-announcements">
          <SectionHeading id="public-announcements">Announcements</SectionHeading>
          {announcementsFailed ? (
            <Alert tone="error" title="Announcements couldn't be loaded right now." />
          ) : announcements.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {announcements.map((a) => (
                <AnnouncementCard key={a.id} announcement={a} timeZone={settings.timezone} href={signedIn ? `/announcements/${a.id}` : undefined} expanded={!signedIn} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<Megaphone className="size-5" aria-hidden="true" />} title="No public announcements right now">
              Members can find more after signing in.
            </EmptyState>
          )}
          {!signedIn ? (
            <p className="mt-4 text-text-secondary">
              Already part of the community?{" "}
              <Link href="/sign-in" className="font-semibold text-primary underline-offset-2 hover:underline">
                Sign in
              </Link>{" "}
              for member news.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
