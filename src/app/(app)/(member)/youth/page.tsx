import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, ListRow, SectionHeading, SectionLink, rowListClass } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ActivityCard, ActivityGrid, NoActivities } from "@/components/youth/learn-play";
import { AnnouncementList, EventList, LearningList } from "@/components/youth/sections";
import { YouthForm } from "@/components/youth/youth-form";
import { requireYouthArea } from "@/lib/auth/viewer";
import { sortForHome } from "@/lib/youth/activities";
import { loadLearnHome, type LearnHome } from "@/lib/youth/learn";
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

/** The Youth & Families section header; a youth account is greeted by name instead. */
function Hero({ title, children }: { title?: string; children: React.ReactNode }) {
  return <SectionHeader section="youth" title={title} description={children} className="mb-8" />;
}

/** How many cards the home shows before "Browse all". */
const HOME_CARDS = 6;

/**
 * Learn & Play on the Youth home: published activities open to a child the
 * viewer may play for. Nothing is shown (and no button offered) for an
 * activity the viewer can't open.
 */
function LearnAndPlay({ learn, covers, mature }: { learn: LearnHome | null; covers: Map<string, string>; mature: boolean }) {
  const items = sortForHome(learn?.activities ?? []);
  return (
    <section aria-labelledby="learn-play">
      <SectionHeading
        id="learn-play"
        description={mature ? "Bible stories, puzzles, and games to try on your own." : "Bible stories, puzzles, and games to enjoy together."}
        action={items.length > HOME_CARDS ? <SectionLink href="/youth/play">Browse all</SectionLink> : items.length ? <SectionLink href="/youth/play">Browse by type</SectionLink> : undefined}
      >
        Learn &amp; Play
      </SectionHeading>
      {!learn ? (
        <Alert tone="error" title="Activities couldn't be loaded right now." />
      ) : learn.players.length === 0 ? (
        <EmptyState glyph="youth" title="Activities are played with a child you're a verified guardian for">
          {learn.other_children > 0
            ? "Playing together needs the “Practice with the child” permission, which the church office sets for each child. A child with their own youth account plays from that account."
            : "Once the church office verifies you as a parent or guardian, published activities appear here for your child."}
        </EmptyState>
      ) : items.length === 0 ? (
        <NoActivities />
      ) : (
        <ActivityGrid>
          {items.slice(0, HOME_CARDS).map((a) => (
            <ActivityCard key={a.id} activity={a} href={`/youth/play/${a.id}`} coverUrl={a.cover_path ? covers.get(a.cover_path) : null} players={learn.players} mature={mature} />
          ))}
        </ActivityGrid>
      )}
    </section>
  );
}

/** This week's lesson: activities connected to this week, and current group learning. */
function ThisWeek({ learn, extra }: { learn: LearnHome | null; extra?: Learning[] }) {
  const week = (learn?.activities ?? []).filter((a) => a.this_week);
  const lesson = [...(learn?.lesson ?? []), ...(extra ?? [])].filter((l, i, all) => all.findIndex((x) => x.id === l.id) === i);
  return (
    <section aria-labelledby="this-week">
      <SectionHeading id="this-week" description="What the youth groups are learning now.">
        This Week&apos;s Lesson
      </SectionHeading>
      {week.length === 0 && lesson.length === 0 ? (
        <EmptyState glyph="lessons" title="Nothing is connected to this week yet">
          When the youth team links an activity or a reading to this week&apos;s lesson, it shows up here.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {week.length ? (
            <div className={rowListClass}>
              {week.map((a) => (
                <ListRow
                  key={a.id}
                  plain
                  href={`/youth/play/${a.id}`}
                  label={a.lesson_title || a.title}
                  description={[a.lesson_title ? a.title : null, a.bible_story || null, a.scripture_refs.join("; ") || null].filter(Boolean).join(" · ") || undefined}
                />
              ))}
            </div>
          ) : null}
          {lesson.length ? <LearningList items={lesson} empty="" /> : null}
        </div>
      )}
    </section>
  );
}

export default async function YouthPage() {
  const viewer = await requireYouthArea("/youth");
  const { data: me } = await youthRead<YouthMe>("youth_me");

  if (viewer.accountKind === "youth") {
    if (!me || me.kind !== "youth") {
      return (
        <>
          <SectionHeader section="youth" title="Youth" />
          <Alert tone="info" title="Your youth account isn't active right now.">
            Please talk with your parent or guardian or the church office. Nothing you saved has been lost.
          </Alert>
        </>
      );
    }
    const [{ data: home, failed }, { home: learn, covers }] = await Promise.all([youthRead<Home>("youth_home"), loadLearnHome()]);
    return (
      <>
        <Hero title={`Hi, ${me.display_name}`}>Things to learn and play, this week&apos;s lesson, your groups, and what&apos;s coming up.</Hero>
        {failed || !home ? (
          <Alert tone="error" title="This page couldn't be loaded right now." />
        ) : (
          <div className="space-y-10">
            <LearnAndPlay learn={learn} covers={covers} mature />
            <ThisWeek learn={learn} extra={home.groups.flatMap((g) => g.learning)} />
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
            <p className="text-meta text-text-secondary">
              Your practice, activities, answers, and journal are yours.{" "}
              <Link href="/youth/account" className="font-semibold text-primary hover:underline">
                See who can see what
              </Link>
              .
            </p>
          </div>
        )}
      </>
    );
  }

  const adult = me && me.kind === "adult" ? me : null;
  const [{ data: announcements }, { home: learn, covers }] = await Promise.all([
    youthRead<Announcement[]>("youth_announcements", { p_group: null }),
    loadLearnHome(),
  ]);
  const isAdmin = (adult?.caps.length ?? 0) > 0;
  return (
    <>
      <Hero>Activities to enjoy together, this week&apos;s lesson, and everything for parents and guardians.</Hero>
      <div className="space-y-10">
        <LearnAndPlay learn={learn} covers={covers} mature={false} />
        <ThisWeek learn={learn} />
        <section aria-labelledby="parents" className="space-y-4">
          <SectionHeading id="parents" description="Your family dashboard, permission forms, groups, events, and announcements.">
            For Parents
          </SectionHeading>
          <div className="grid gap-4 sm:grid-cols-2">
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
                <p className="text-text-secondary">Policies, guardian verification, groups, forms, photo consent, and activities.</p>
                <ButtonLink href="/admin/youth" variant="secondary">
                  Administration
                </ButtonLink>
              </Card>
            ) : null}
          </div>
          {adult && adult.guardian_of > 0 ? (
            <div className={rowListClass}>
              <ListRow plain href="/youth/family" label="Groups, events, and permission forms" description="Open a child on the family dashboard to register, sign forms, and see their groups." />
              <ListRow plain href="/youth/announcements" label="All youth announcements" />
            </div>
          ) : null}
          <div>
            <SectionHeading id="ann" as="h3">
              Announcements
            </SectionHeading>
            <AnnouncementList items={announcements ?? []} empty="Youth announcements for your children's groups appear here." />
          </div>
        </section>
      </div>
    </>
  );
}
