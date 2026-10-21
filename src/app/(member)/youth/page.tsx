import type { Metadata } from "next";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { AnnouncementList, EventList, LearningList } from "@/components/youth/sections";
import { YouthForm } from "@/components/youth/youth-form";
import { menuArtSource } from "@/lib/home/launcher";
import { requireYouthArea } from "@/lib/auth/viewer";
import { youthRead } from "@/lib/youth/queries";
import type { Announcement, ChildEvent, Learning, YouthMe } from "@/lib/youth/types";

export const metadata: Metadata = { title: "Youth" };

type Home = {
  display_name: string;
  groups: Array<{ id: string; name: string; description: string; leaders: string[]; learning: Learning[] }>;
  announcements: Announcement[];
  events: ChildEvent[];
  discussions_enabled: boolean;
};

function Hero({ title, children }: { title: string; children: React.ReactNode }) {
  const art = menuArtSource("youth");
  return (
    <div className="mb-8 flex items-center gap-4 rounded-card border border-border bg-surface p-5 shadow-(--elev-card) sm:gap-6 sm:p-6">
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art.src} srcSet={art.srcSet} sizes="96px" alt="" className="size-20 shrink-0 rounded-tile sm:size-24" />
      ) : (
        <TileIcon name="youth" className="size-20" />
      )}
      <div className="min-w-0">
        <h1 className="font-display text-display font-semibold text-text sm:text-[2.125rem]">{title}</h1>
        <div className="mt-1 text-text-secondary">{children}</div>
      </div>
    </div>
  );
}

export default async function YouthPage() {
  const viewer = await requireYouthArea("/youth");
  const { data: me } = await youthRead<YouthMe>("youth_me");

  if (viewer.accountKind === "youth") {
    if (!me || me.kind !== "youth") {
      return (
        <>
          <PageHeader title="Youth" />
          <Alert tone="info" title="Your youth account isn't active right now.">
            Please talk with your parent or guardian or the church office. Nothing you saved has been lost.
          </Alert>
        </>
      );
    }
    const { data: home, failed } = await youthRead<Home>("youth_home");
    return (
      <>
        <Hero title={`Hi, ${me.display_name}`}>Your groups, what&apos;s coming up, and what to learn this week.</Hero>
        {failed || !home ? (
          <Alert tone="error" title="This page couldn't be loaded right now." />
        ) : (
          <div className="space-y-10">
            <section aria-labelledby="ann">
              <SectionHeading id="ann">Announcements</SectionHeading>
              <AnnouncementList items={home.announcements} empty="No announcements right now." />
            </section>
            <section aria-labelledby="events">
              <SectionHeading id="events">Coming up</SectionHeading>
              <EventList
                items={home.events}
                empty="Nothing scheduled for your groups yet."
                render={(e) =>
                  e.registration && e.registration.status !== "canceled" ? (
                    <YouthForm op="rsvp_cancel" hidden={{ occurrence: e.occurrence_id, child: me.child_id }} submit="Cancel my place" variant="secondary" size="sm" inline pendingText="Canceling…" />
                  ) : e.youth_rsvp && !e.needs_guardian && e.rsvp_enabled ? (
                    <YouthForm op="rsvp" hidden={{ occurrence: e.occurrence_id }} submit="Count me in" size="sm" inline pendingText="Saving…" />
                  ) : (
                    <p className="text-meta text-text-secondary">A parent or guardian registers you for this one.</p>
                  )
                }
              />
            </section>
            <section aria-labelledby="groups">
              <SectionHeading id="groups">My groups</SectionHeading>
              {home.groups.length === 0 ? (
                <EmptyState glyph="youth" title="You're not in a youth group yet">Leaders add you to groups.</EmptyState>
              ) : (
                <div className={rowListClass}>
                  {home.groups.map((g) => (
                    <ListRow key={g.id} plain href={`/youth/groups/${g.id}`} label={g.name} description={g.leaders.length ? `Leaders: ${g.leaders.join(", ")}` : undefined} />
                  ))}
                </div>
              )}
            </section>
            <section aria-labelledby="learn">
              <SectionHeading id="learn">Learning this week</SectionHeading>
              <LearningList items={home.groups.flatMap((g) => g.learning)} empty="Nothing assigned right now." />
              <p className="mt-3 text-meta text-text-secondary">
                Your practice, answers, and journal are yours.{" "}
                <Link href="/youth/account" className="font-semibold text-primary hover:underline">
                  See who can see what
                </Link>
                .
              </p>
            </section>
          </div>
        )}
      </>
    );
  }

  const adult = me && me.kind === "adult" ? me : null;
  const { data: announcements } = await youthRead<Announcement[]>("youth_announcements", { p_group: null });
  const isAdmin = (adult?.caps.length ?? 0) > 0;
  return (
    <>
      <Hero title="Youth & Families">Youth groups, events, permission forms, and learning, for verified families and leaders.</Hero>
      <div className="space-y-10">
        <section aria-labelledby="family" className="grid gap-4 sm:grid-cols-2">
          <h2 id="family" className="sr-only">
            Where to go
          </h2>
          <Card className="space-y-3">
            <h3 className="text-[1.125rem] font-semibold">For parents and guardians</h3>
            {adult && adult.guardian_of > 0 ? (
              <p className="text-text-secondary">
                You&apos;re a verified guardian for {adult.guardian_of} {adult.guardian_of === 1 ? "child" : "children"}.
              </p>
            ) : (
              <p className="text-text-secondary">
                Ask the church office to link you to your child. Being in the same household isn&apos;t enough: each relationship is verified in person.
              </p>
            )}
            {adult && adult.paused_guardianships > 0 ? (
              <Badge tone="danger">Access to {adult.paused_guardianships} paused by the church office</Badge>
            ) : null}
            {adult && adult.pending_requests > 0 ? <Badge tone="warning">{adult.pending_requests} request waiting for review</Badge> : null}
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/youth/family">Family dashboard</ButtonLink>
              <ButtonLink href="/youth/family/request" variant="secondary">
                Link a child
              </ButtonLink>
            </div>
          </Card>
          {adult && (adult.leads > 0 || adult.personnel > 0) ? (
            <Card className="space-y-3">
              <h3 className="text-[1.125rem] font-semibold">For leaders</h3>
              <p className="text-text-secondary">Your groups, announcements, discussions, and event lists.</p>
              <ButtonLink href="/youth/lead">Leading</ButtonLink>
            </Card>
          ) : null}
          {isAdmin ? (
            <Card className="space-y-3">
              <h3 className="text-[1.125rem] font-semibold">Youth & family administration</h3>
              <p className="text-text-secondary">Policies, guardian verification, groups, forms, and photo consent.</p>
              <ButtonLink href="/admin/youth" variant="secondary">
                Administration
              </ButtonLink>
            </Card>
          ) : null}
        </section>
        <section aria-labelledby="ann">
          <SectionHeading id="ann">Announcements</SectionHeading>
          <AnnouncementList items={announcements ?? []} empty="Youth announcements for your children's groups appear here." />
        </section>
      </div>
    </>
  );
}
