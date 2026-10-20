import { Cake, Home, Mail, MapPin, Phone, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, SectionHeading } from "@/components/ui/card";
import { cityLine, formatBirthday, mailtoHref, telHref } from "@/lib/directory/format";
import type { DirectoryProfile } from "@/lib/directory/queries";
import { MemberAvatar } from "./member-avatar";

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center text-text-secondary">{icon}</span>
      <div className="min-w-0">
        <dt className="text-sm font-semibold text-text-secondary">{label}</dt>
        <dd className="break-words">{children}</dd>
      </div>
    </div>
  );
}

const linkClass = "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline";

/**
 * A member's directory profile, exactly as approved members see it. It only
 * ever receives fields the member shares (hidden ones arrive as null), and
 * shows call/email links only for those.
 */
export function DirectoryProfileView({ profile, linkHousehold = true }: { profile: DirectoryProfile; linkHousehold?: boolean }) {
  const tel = profile.phone ? telHref(profile.phone) : null;
  const mailto = profile.contactEmail ? mailtoHref(profile.contactEmail) : null;
  const place = cityLine(profile.city, profile.stateRegion, profile.streetAddress ? profile.postalCode : null);
  const birthday = formatBirthday(profile.birthdayMonth, profile.birthdayDay);
  const showFull = profile.fullName && profile.fullName !== profile.displayName;
  const hasContact = profile.phone || profile.contactEmail || profile.streetAddress || place;

  return (
    <div className="space-y-6">
      <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <MemberAvatar name={profile.displayName} photoUrl={profile.photoUrl} size="lg" />
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] font-semibold leading-tight">{profile.displayName}</h1>
          {showFull ? <p className="text-text-secondary">{profile.fullName}</p> : null}
          {place && !profile.streetAddress ? <p className="mt-1 text-text-secondary">{place}</p> : null}
        </div>
      </Card>

      {hasContact ? (
        <Card>
          <SectionHeading>Contact</SectionHeading>
          <dl className="divide-y divide-border">
            {profile.phone ? (
              <Row icon={<Phone className="size-5" aria-hidden="true" />} label="Phone">
                {tel ? (
                  <a href={tel} className={linkClass}>
                    {profile.phone}
                  </a>
                ) : (
                  profile.phone
                )}
              </Row>
            ) : null}
            {profile.contactEmail ? (
              <Row icon={<Mail className="size-5" aria-hidden="true" />} label="Email">
                {mailto ? (
                  <a href={mailto} className={`${linkClass} break-all`}>
                    {profile.contactEmail}
                  </a>
                ) : (
                  profile.contactEmail
                )}
              </Row>
            ) : null}
            {profile.streetAddress ? (
              <Row icon={<MapPin className="size-5" aria-hidden="true" />} label="Address">
                <span className="block">{profile.streetAddress}</span>
                {place ? <span className="block">{place}</span> : null}
              </Row>
            ) : place ? (
              <Row icon={<MapPin className="size-5" aria-hidden="true" />} label="Location">
                {place}
              </Row>
            ) : null}
          </dl>
        </Card>
      ) : null}

      {profile.bio || birthday || profile.ministryInterests?.length ? (
        <Card>
          <SectionHeading>About</SectionHeading>
          {profile.bio ? <p className="mb-2 whitespace-pre-line">{profile.bio}</p> : null}
          <dl className="divide-y divide-border">
            {birthday ? (
              <Row icon={<Cake className="size-5" aria-hidden="true" />} label="Birthday">
                {birthday}
              </Row>
            ) : null}
            {profile.ministryInterests?.length ? (
              <Row icon={<Sparkles className="size-5" aria-hidden="true" />} label="Ministry interests">
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {profile.ministryInterests.map((i) => (
                    <li key={i} className="rounded-full bg-surface-muted px-3 py-1 text-meta text-text">
                      {i}
                    </li>
                  ))}
                </ul>
              </Row>
            ) : null}
          </dl>
        </Card>
      ) : null}

      {profile.householdMembers?.length ? (
        <Card>
          <SectionHeading>
            <span className="inline-flex items-center gap-2">
              <Home className="size-4" aria-hidden="true" /> Household
            </span>
          </SectionHeading>
          {profile.householdName ? <p className="mb-2 font-semibold">{profile.householdName}</p> : null}
          <ul className="space-y-1">
            {profile.householdMembers.map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <Users className="size-5 text-text-secondary" aria-hidden="true" />
                {linkHousehold ? (
                  <Link href={`/directory/${m.id}`} className={linkClass}>
                    {m.display_name}
                  </Link>
                ) : (
                  <span className="min-h-11 content-center">{m.display_name}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
