import { ChevronLeft, ChevronRight, MessagesSquare, NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookmarkButton } from "@/components/bible/bookmark-button";
import { CompleteToggle } from "@/components/bible/complete-toggle";
import { FumsTracker } from "@/components/bible/fums";
import { Attribution, ScriptureText } from "@/components/bible/scripture";
import { CommunityText } from "@/components/community/community-text";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, SectionHeading, rowListClass } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { formatYmd } from "@/lib/bible/dates";
import { kindLabel } from "@/lib/bible/format";
import { resolveText, type TextResult } from "@/lib/bible/source";
import type { Enrollment, PassagePayload, PlanCard, PlanPassage } from "@/lib/bible/types";
import { isUuid } from "@/lib/media/format";
import { dbErrorMessage } from "@/lib/supabase/errors";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Today's reading" };

type Day = {
  id: string;
  kind: "reading" | "rest" | "catch_up";
  heading: string | null;
  notes: string;
  questions: string[];
  label: string;
  revision: number;
  retired: boolean;
  scheduled: string | null;
  today: string;
  plan: PlanCard;
  enrollment: Enrollment | null;
  completed: boolean;
  completed_revision: number | null;
  completed_snapshot: { passages: Array<{ label: string }> } | null;
  passages: PlanPassage[];
  prev_id: string | null;
  next_id: string | null;
  discussion: { id: string; title: string } | null;
  links: Array<{ id: string; kind: "devotional" | "lesson"; title: string }>;
};

const REASONS: Record<Extract<TextResult, { status: "unavailable" }>["reason"], string> = {
  not_configured: "This translation's source isn't set up yet, so the text can't be shown. Nothing else is shown in its place.",
  outage: "The scripture source isn't responding right now. Try again in a little while; nothing else is shown in its place.",
  rejected: "The scripture source couldn't provide this passage.",
};

export default async function DayPage({ params }: PageProps<"/bible/day/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireApprovedMember(`/bible/day/${id}`);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_day", { p_day: id });
  if (error?.code === "P0002") notFound();
  if (error || !data) return <Alert tone="error" title="This reading couldn't be loaded right now." />;
  const day = data as Day;
  const active = day.enrollment?.status === "active";

  // Each passage separately, in order; an unavailable one is said so plainly.
  const texts = await Promise.all(
    day.passages.map(async (p) => {
      const r = await supabase.rpc("bible_passage", { p_translation: day.plan.translation.id, p_book: p.book, p_sc: p.sc, p_sv: p.sv, p_ec: p.ec, p_ev: p.ev });
      if (r.error || !r.data) return { p, payload: null, text: null, problem: dbErrorMessage(r.error, "This passage couldn't be loaded.") };
      const payload = r.data as PassagePayload;
      const text = await resolveText(payload.translation, payload.verses, payload.provider, { book: p.book, sc: p.sc, sv: p.sv, ec: p.ec, ev: p.ev });
      return { p, payload, text, problem: null };
    }),
  );
  const [bookmarks, notes] = await Promise.all([
    supabase.rpc("bible_bookmarks"),
    supabase.rpc("journal_linked", { p: { day_id: day.id } }),
  ]);
  const bookmarked = ((bookmarks.data as Array<{ kind: string; day: { id: string } | null }> | null) ?? []).some((b) => b.kind === "assignment" && b.day?.id === day.id);
  const myNotes = (notes.data as Array<{ id: string; title: string; excerpt: string; question: string | null }> | null) ?? [];
  const fums = texts.flatMap((t) => (t.text?.status === "ok" && t.text.fumsId ? [t.text.fumsId] : []));
  const translation = texts.find((t) => t.payload)?.payload?.translation;
  const isToday = day.scheduled === day.today;

  return (
    <>
      <p className="mb-4">
        <Link href={`/bible/plans/${day.plan.id}`} className="font-semibold text-primary hover:underline">
          {day.plan.title}
        </Link>
      </p>
      <header className="mb-6">
        <p className="text-meta font-semibold text-text-secondary">
          {day.label}
          {day.plan.mode === "personal" && day.scheduled ? ` · ${formatYmd(day.scheduled, "long")}` : ""}
          {isToday ? " · Today" : ""}
        </p>
        <h1 className="mt-1 font-display text-display font-semibold">{day.heading ?? (day.kind === "reading" ? day.passages.map((p) => p.label).join("; ") : kindLabel(day.kind))}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {day.kind !== "reading" ? <Badge tone="info">{kindLabel(day.kind)}</Badge> : null}
          {day.retired ? <Badge>No longer part of the plan</Badge> : null}
        </div>
      </header>

      {day.completed_snapshot ? (
        <Alert tone="info" title="This reading changed after you read it" className="mb-6">
          You read {day.completed_snapshot.passages.map((p) => p.label).join("; ")}. Your progress counts it as read.
        </Alert>
      ) : null}

      {day.kind === "rest" ? (
        <Card className="mb-6">
          <p className="font-semibold">A day to rest.</p>
          <p className="text-text-secondary">There&apos;s nothing to mark today. Rest days never count as missed.</p>
        </Card>
      ) : null}

      {day.notes ? (
        <CommunityText source={day.notes} className="mb-6 text-text-secondary" />
      ) : null}

      {texts.map(({ p, payload, text, problem }) => (
        <section key={p.id} aria-labelledby={`passage-${p.id}`} className="mb-8">
          <h2 id={`passage-${p.id}`} className="mb-3 text-title font-semibold">
            {p.label}
            {payload ? <span className="ml-2 text-meta font-semibold text-text-secondary">{payload.translation.code}</span> : null}
          </h2>
          {problem ? (
            <Alert tone="warning" title="This passage isn't available.">
              {problem}
            </Alert>
          ) : text?.status === "unavailable" ? (
            <Alert tone="warning" title="This passage isn't available right now.">
              {REASONS[text.reason]}
            </Alert>
          ) : payload && text?.status === "ok" ? (
            <>
              <ScriptureText verses={text.verses} translation={payload.translation} showChapters={p.ec !== p.sc} label={`${p.label}, ${payload.translation.code}`} />
              <p className="mt-2 text-meta">
                <Link href={`/bible/read/${payload.translation.code}/${p.book}/${p.sc}`} className="font-semibold text-primary hover:underline">
                  Read the whole chapter
                </Link>
              </p>
              {text.copyright && text.copyright !== payload.translation.copyright ? <p className="mt-1 text-meta text-text-secondary">{text.copyright}</p> : null}
            </>
          ) : null}
        </section>
      ))}
      {translation ? <Attribution translation={translation} /> : null}

      {day.kind !== "rest" && active && !day.retired ? (
        <div className="my-8">
          <CompleteToggle dayId={day.id} completed={day.completed} />
        </div>
      ) : !active ? (
        <p className="my-6 text-meta text-text-secondary">
          <Link href={`/bible/plans/${day.plan.id}`} className="font-semibold text-primary hover:underline">
            Join this plan
          </Link>{" "}
          to keep track of what you&apos;ve read.
        </p>
      ) : null}

      {day.questions.length ? (
        <section aria-labelledby="reflect" className="mb-8">
          <SectionHeading id="reflect" description="Answers you write are private. Nothing is shared unless you post it in a discussion yourself.">
            Reflect
          </SectionHeading>
          <ul className="space-y-3">
            {day.questions.map((q, i) => (
              <li key={i} className="rounded-card border border-border bg-surface p-4">
                <p className="font-semibold">{q}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ButtonLink href={`/journal/new?${new URLSearchParams({ day: day.id, q: String(i) })}`} size="sm" variant="secondary" icon={<NotebookPen className="size-4" aria-hidden="true" />}>
                    Write privately
                  </ButtonLink>
                  {day.discussion ? (
                    <ButtonLink href={`/community/t/${day.discussion.id}`} size="sm" variant="ghost" icon={<MessagesSquare className="size-4" aria-hidden="true" />}>
                      Join discussion
                    </ButtonLink>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mb-8 flex flex-wrap gap-2">
        {!day.questions.length ? (
          <ButtonLink href={`/journal/new?${new URLSearchParams({ day: day.id })}`} size="sm" variant="secondary" icon={<NotebookPen className="size-4" aria-hidden="true" />}>
            Write privately
          </ButtonLink>
        ) : null}
        {day.discussion && !day.questions.length ? (
          <ButtonLink href={`/community/t/${day.discussion.id}`} size="sm" variant="ghost" icon={<MessagesSquare className="size-4" aria-hidden="true" />}>
            Join discussion
          </ButtonLink>
        ) : null}
        <BookmarkButton input={{ kind: "assignment", day_id: day.id }} bookmarked={bookmarked} label="Bookmark this reading" />
      </div>

      {myNotes.length ? (
        <section aria-labelledby="my-notes" className="mb-8">
          <SectionHeading id="my-notes" description="Only you can see these.">
            Your notes
          </SectionHeading>
          <ul className={rowListClass}>
            {myNotes.map((n) => (
              <li key={n.id}>
                <Link href={`/journal/${n.id}`} className="block px-4 py-3 hover:bg-surface-muted/60">
                  <span className="block font-semibold">{n.title || "Untitled"}</span>
                  <span className="line-clamp-2 block text-meta text-text-secondary">{n.question ? `${n.question} · ` : ""}{n.excerpt}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {day.links.length ? (
        <section aria-labelledby="related" className="mb-8">
          <SectionHeading id="related">Related teaching</SectionHeading>
          <ul className={rowListClass}>
            {day.links.map((l) => (
              <li key={l.id}>
                <Link href={`/${l.kind === "lesson" ? "lessons" : "devotionals"}/${l.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block text-meta text-text-secondary">{l.kind === "lesson" ? "Sunday lesson" : "Devotional"}</span>
                    <span className="block truncate font-semibold">{l.title}</span>
                  </span>
                  <ChevronRight className="size-5 text-text-secondary" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav aria-label="Other days" className="flex justify-between gap-3 border-t border-border pt-4">
        {day.prev_id ? (
          <ButtonLink href={`/bible/day/${day.prev_id}`} variant="ghost" size="sm" icon={<ChevronLeft className="size-4" aria-hidden="true" />}>
            Previous day
          </ButtonLink>
        ) : (
          <span />
        )}
        {day.next_id ? (
          <ButtonLink href={`/bible/day/${day.next_id}`} variant="ghost" size="sm">
            Next day <ChevronRight className="size-4" aria-hidden="true" />
          </ButtonLink>
        ) : null}
      </nav>
      <FumsTracker ids={fums} />
    </>
  );
}
