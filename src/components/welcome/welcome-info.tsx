import { CalendarClock, Mail, MapPin, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { AnnouncementCard } from "@/components/announcements/announcement-card";
import { Alert } from "@/components/ui/alert";
import type { AnnouncementWithImage } from "@/lib/announcements/queries";
import { hasAddress, type ChurchSettings } from "@/lib/settings/queries";
import { WEEKDAY_LABEL } from "@/lib/settings/schema";
import { formatClockTime, timeZoneLabel } from "@/lib/time";

const linkClass = "font-semibold text-primary underline decoration-1 underline-offset-4 hover:text-primary-hover hover:decoration-2";

/** Gold eyebrow rule and serif heading shared by the sections below the strip. */
function SectionTitle({ id, eyebrow, children }: { id: string; eyebrow: string; children: ReactNode }) {
  return (
    <div className="mb-8 text-center">
      <p className="text-eyebrow font-semibold tracking-[0.2em] text-primary uppercase">{eyebrow}</p>
      <h2 id={id} className="mt-2 font-display text-[1.875rem] leading-tight font-medium text-text sm:text-[2.25rem]">
        {children}
      </h2>
      <span aria-hidden="true" className="mx-auto mt-4 block h-px w-14 bg-(--welcome-gold)" />
    </div>
  );
}

function InfoPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface p-6 sm:p-8">
      <h3 className="font-display text-[1.375rem] leading-snug font-medium text-text">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/**
 * The church's configured gathering times and contact details. Only what an
 * administrator has entered is shown; with nothing configured the section is
 * left out rather than filled with placeholders.
 */
export function GatheringInfo({ settings }: { settings: ChurchSettings }) {
  const times = settings.gatheringTimes;
  const address = hasAddress(settings);
  const contact = address || settings.contactEmail || settings.contactPhone;
  if (!times.length && !contact) return null;

  return (
    <section aria-labelledby="visit-heading" className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-18">
      <SectionTitle id="visit-heading" eyebrow="Visit">
        Join us
      </SectionTitle>
      <div className={`mx-auto grid max-w-4xl gap-5 ${times.length && contact ? "md:grid-cols-2" : "max-w-xl"}`}>
        {times.length ? (
          <InfoPanel title="Gathering times">
            <ul className="space-y-4">
              {times.map((g, i) => (
                <li key={`${g.label}-${i}`} className="flex gap-3">
                  <CalendarClock className="mt-1 size-5 shrink-0 text-(--welcome-gold)" aria-hidden="true" />
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
            <p className="mt-5 text-meta text-text-secondary">Times shown in {timeZoneLabel(settings.timezone)}.</p>
          </InfoPanel>
        ) : null}

        {contact ? (
          <InfoPanel title="Find us">
            <ul className="space-y-4">
              {address ? (
                <li className="flex gap-3">
                  <MapPin className="mt-1 size-5 shrink-0 text-(--welcome-gold)" aria-hidden="true" />
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
                  <Mail className="mt-1 size-5 shrink-0 text-(--welcome-gold)" aria-hidden="true" />
                  <a href={`mailto:${settings.contactEmail}`} className={`${linkClass} break-all`}>
                    {settings.contactEmail}
                  </a>
                </li>
              ) : null}
              {settings.contactPhone ? (
                <li className="flex gap-3">
                  <Phone className="mt-1 size-5 shrink-0 text-(--welcome-gold)" aria-hidden="true" />
                  <a href={`tel:${settings.contactPhone.replace(/[^0-9+]/g, "")}`} className={linkClass}>
                    {settings.contactPhone}
                  </a>
                </li>
              ) : null}
            </ul>
          </InfoPanel>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Live public announcements (published or due, unexpired, pinned first; the
 * query enforces visibility). Hidden when there are none.
 */
export function PublicAnnouncements({
  announcements,
  failed,
  signedIn,
  timeZone,
}: {
  announcements: AnnouncementWithImage[];
  failed: boolean;
  signedIn: boolean;
  timeZone: string;
}) {
  if (!failed && !announcements.length) return null;
  return (
    <section aria-labelledby="public-announcements" className="border-t border-(--welcome-rule) bg-surface-muted/50">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-18">
        <SectionTitle id="public-announcements" eyebrow="News">
          Announcements
        </SectionTitle>
        {failed ? (
          <div className="mx-auto max-w-xl">
            <Alert tone="error" title="Announcements couldn't be loaded right now." />
          </div>
        ) : (
          <div className={`mx-auto grid gap-5 ${announcements.length > 1 ? "md:grid-cols-2 lg:grid-cols-3" : "max-w-xl"}`}>
            {announcements.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} timeZone={timeZone} href={signedIn ? `/announcements/${a.id}` : undefined} expanded={!signedIn} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
