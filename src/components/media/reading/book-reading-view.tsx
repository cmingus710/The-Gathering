/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { CalendarDays, Circle, CircleCheck, GraduationCap, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { MarkdownBody } from "@/components/announcements/markdown-body";
import { TileIcon } from "@/components/icons/icon";
import { BackLink } from "@/components/ui/back-link";
import { SectionHeading } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { segmentClass } from "@/components/ui/segmented";
import { formatDay } from "@/lib/media/format";
import {
  assignmentTiming,
  choosePlan,
  currentAssignment,
  groupPlans,
  nextAssignment,
  planCompletion,
  type PlanAssignment,
  type PlanNote,
} from "@/lib/media/reading-plan";
import type { ItemDetail } from "@/lib/media/types";
import { BookAccess } from "../book-access";
import { BookProgressForm } from "../book-progress-form";
import { FileRow } from "../content-detail";
import { ItemCard, itemCover } from "../item-card";
import { BookmarkButton } from "../toggles";
import { AssignmentBody, assignmentDates } from "./assignment-body";
import { PrivateNotes } from "./private-notes";
import { ReadMore } from "./read-more";
import { ScrollToSelected } from "./scroll-to-selected";
import { VideoList } from "../video-list";

export type BookExtras = {
  kindle_url: string | null;
  reading_starts_on: string | null;
  reading_ends_on: string | null;
  related_lesson: { id: string; title: string } | null;
  progress: { status: "want" | "reading" | "finished"; position: string | null; updated_at: string } | null;
};

export type BookPlanData = { today: string; assignments: PlanAssignment[]; notes: PlanNote[] };

/**
 * The church reading page for one book (see the route for how it's loaded):
 * 1 the book, 2 Audible/Kindle links, 3 the member's own place in the book
 * and this plan's check-offs (separate records), 4 the current assignment,
 * 5 the full schedule, 6 private notes. Pure rendering from loaded data.
 */
export function BookReadingView({
  item,
  urls,
  extras,
  plan,
  planDetails,
  requestedAssignment,
  requestedPlan,
}: {
  item: ItemDetail;
  urls: Map<string, string>;
  extras: BookExtras | null;
  plan: BookPlanData;
  /** False before 20261104000100: cards only, no per-assignment details or notes list. */
  planDetails: boolean;
  requestedAssignment: string | null;
  requestedPlan: string | null;
}) {
  const id = item.id;
  const { today } = plan;

  const plans = groupPlans(plan.assignments);
  const selectedId = requestedAssignment && plan.assignments.some((a) => a.id === requestedAssignment) ? requestedAssignment : null;
  const shown = choosePlan(plans, requestedPlan, selectedId);
  const current = shown ? currentAssignment(shown.assignments, today) : null;
  const featured = current ?? (shown ? nextAssignment(shown.assignments, today) : null);
  const completion = shown ? planCompletion(shown) : null;

  const cover = itemCover(item, urls, "large");
  const description = item.body.trim() ? <MarkdownBody source={item.body} className="reading-body" /> : item.summary ? <p className="text-text-secondary">{item.summary}</p> : null;
  const dates =
    extras?.reading_starts_on || extras?.reading_ends_on
      ? [extras.reading_starts_on ? formatDay(extras.reading_starts_on, "short") : null, extras.reading_ends_on ? formatDay(extras.reading_ends_on, "short") : null]
          .filter(Boolean)
          .join(" – ")
      : null;
  const files = item.attachments.filter((a) => a.role !== "audio" && a.role !== "video");
  // The selected assignment is shown in full above when it's the featured one.
  const targetId = selectedId ? (selectedId === featured?.id ? "featured-assignment" : `assignment-${selectedId}`) : null;
  const planHref = (key: string) => `/reading/books/${id}?plan=${encodeURIComponent(key)}`;

  return (
    <>
      <BackLink route="/reading/books/[id]" />
      {targetId ? <ScrollToSelected targetId={targetId} /> : null}
      <article className="space-y-6 sm:space-y-8">
        {/* 1 · Compact book header: the full cover at its own proportions beside the details. */}
        <header className="flex gap-3 min-[400px]:gap-4 sm:gap-6">
          {cover ? (
            <img
              src={cover}
              alt={item.cover?.alt ?? ""}
              width={item.cover?.width ?? undefined}
              height={item.cover?.height ?? undefined}
              className="h-auto w-20 shrink-0 self-start rounded-tile border border-border object-contain shadow-(--elev-card) min-[400px]:w-24 sm:w-36 lg:w-40"
            />
          ) : (
            <span className="flex h-32 w-20 shrink-0 items-center justify-center rounded-tile bg-surface-muted sm:h-52 sm:w-36" aria-hidden="true">
              <TileIcon name="reading" className="size-12" />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-meta font-semibold text-text-secondary">{item.book_current ? "Current book" : "Book"}</p>
            <h1 className="font-display text-xl font-semibold leading-tight text-text [overflow-wrap:anywhere] min-[400px]:text-2xl sm:text-[2.125rem]">{item.title}</h1>
            {item.book_author ? <p className="text-text-secondary">by {item.book_author}</p> : null}
            {dates || extras?.related_lesson ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta">
                {dates ? (
                  <li className="flex items-center gap-1.5">
                    <CalendarDays className="size-4 text-primary" aria-hidden="true" />
                    <span>
                      <span className="sr-only">Reading dates: </span>
                      {dates}
                    </span>
                  </li>
                ) : null}
                {extras?.related_lesson ? (
                  <li className="flex items-center gap-1.5">
                    <GraduationCap className="size-4 text-primary" aria-hidden="true" />
                    <Link href={`/lessons/${extras.related_lesson.id}`} className="font-semibold text-primary hover:underline">
                      <span className="sr-only">Related lesson: </span>
                      {extras.related_lesson.title}
                    </Link>
                  </li>
                ) : null}
              </ul>
            ) : null}
            {description ? <ReadMore className="hidden sm:block">{description}</ReadMore> : null}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <BookmarkButton type="item" id={item.id} saved={item.bookmarked} label={item.title} />
              {item.discussion ? (
                <Link
                  href={`/community/t/${item.discussion.thread_id}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border-strong/60 bg-surface px-4 text-meta font-semibold hover:bg-surface-muted"
                >
                  <MessagesSquare className="size-4" aria-hidden="true" />
                  Discussion
                  <span className="sr-only"> about {item.title}</span>
                </Link>
              ) : null}
            </div>
          </div>
        </header>
        {/* On phones the description runs full width under the cover row. */}
        {description ? <ReadMore className="-mt-2 sm:hidden">{description}</ReadMore> : null}

        {/* 2 · Read or listen (only configured links). */}
        <BookAccess kindleUrl={extras?.kindle_url ?? null} audibleUrl={item.audible_url} />

        {plans.length > 1 && shown ? (
          <nav aria-label="Reading plan" className="space-y-1.5">
            <p className="text-meta text-text-secondary">
              This book is in {plans.length} reading plans you&apos;re part of. Your place in the book is shared; assignment check-offs belong to each plan.
            </p>
            <div className="inline-flex max-w-full flex-wrap gap-1 rounded-card border border-border bg-surface-muted p-1">
              {plans.map((p) => (
                <Link key={p.key} href={planHref(p.key)} className={segmentClass(p.key === shown.key)} aria-current={p.key === shown.key ? "page" : undefined}>
                  {p.label}
                </Link>
              ))}
            </div>
          </nav>
        ) : null}

        {/* 3 · My reading progress: my own place (one record per book) vs. this plan's check-offs. */}
        <section aria-labelledby="progress-heading">
          <SectionHeading id="progress-heading">My reading progress</SectionHeading>
          <div className={cn("grid gap-3", completion?.total ? "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : null)}>
            {extras ? (
              <div className="rounded-card border border-border bg-surface p-4 sm:p-5">
                <BookProgressForm id={id} progress={extras.progress} legend="My place in the book" />
              </div>
            ) : (
              <p className="rounded-card border border-border bg-surface p-4 text-meta text-text-secondary">Your reading progress isn&apos;t available right now.</p>
            )}
            {completion?.total ? (
              <div className="rounded-card border border-border bg-surface p-4 sm:p-5">
                <h3 className="font-semibold">Reading-plan assignments completed</h3>
                <p className="mt-1 text-2xl font-semibold">
                  {completion.done} <span className="text-base font-normal text-text-secondary">of {completion.total}</span>
                </p>
                <div
                  role="progressbar"
                  aria-label="Assignments you marked done"
                  aria-valuemin={0}
                  aria-valuemax={completion.total}
                  aria-valuenow={completion.done}
                  aria-valuetext={`${completion.done} of ${completion.total} assignments done (${completion.percent}%)`}
                  className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"
                >
                  <div className="h-full rounded-full bg-success" style={{ width: `${completion.percent}%` }} />
                </div>
                <p className="mt-2 text-meta text-text-secondary">
                  {plans.length > 1 ? `${shown?.label} plan. ` : ""}Counts the assignments you marked done; it doesn&apos;t change your place in the book.
                </p>
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-meta text-text-secondary">Private to you. Nothing syncs from Kindle or Audible.</p>
        </section>

        {/* 4 · The current (or next) assignment, in full, with its own "Mark as done". */}
        {featured ? (
          <section
            id="featured-assignment"
            tabIndex={-1}
            aria-labelledby="featured-heading"
            className="scroll-mt-24 rounded-card border-2 border-primary/50 bg-surface p-4 shadow-(--elev-card) focus-visible:outline-3 focus-visible:outline-primary sm:p-6"
          >
            <p className="text-meta font-semibold text-primary">
              {current ? "This week's assignment" : "Up next"}
              {featured.starts_on ? (
                <>
                  {" · "}
                  <time dateTime={featured.starts_on}>{assignmentDates(featured)}</time>
                </>
              ) : null}
            </p>
            <h2 id="featured-heading" className="mb-3 font-display text-xl font-semibold leading-snug sm:text-2xl">
              {featured.title}
            </h2>
            {planDetails ? (
              <AssignmentBody a={featured} canNote />
            ) : (
              <p>
                <Link href={`/reading/assignments/${featured.id}`} className="font-semibold text-primary hover:underline">
                  Open this assignment
                </Link>
              </p>
            )}
          </section>
        ) : null}

        {/* 5 · Full schedule: expand any week in place. */}
        {shown ? (
          <section aria-labelledby="schedule-heading">
            <SectionHeading id="schedule-heading" description={`${shown.assignments.length} assignment${shown.assignments.length === 1 ? "" : "s"}`}>
              Reading schedule
            </SectionHeading>
            <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
              {shown.assignments.map((a) => {
                const timing = assignmentTiming(a, today, current?.id ?? null);
                const isFeatured = a.id === featured?.id;
                return (
                  <li key={a.id} className={cn(timing === "now" && "bg-primary-soft/40")}>
                    <details id={`assignment-${a.id}`} tabIndex={-1} open={a.id === selectedId && !isFeatured} className="group scroll-mt-24">
                      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-muted/60 [&::-webkit-details-marker]:hidden">
                        {a.completed ? (
                          <CircleCheck className="size-5 shrink-0 text-success" aria-label="Done" />
                        ) : (
                          <Circle className="size-5 shrink-0 text-text-secondary" aria-label="Not done" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-meta text-text-secondary">
                            {a.starts_on ? <time dateTime={a.starts_on}>{assignmentDates(a)}</time> : null}
                            {timing === "now" ? <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[0.75rem] font-semibold text-on-primary">This week</span> : null}
                            {timing === "upcoming" && isFeatured ? <span className="ml-2 font-semibold text-primary">Up next</span> : null}
                          </span>
                          <span className="block font-semibold [overflow-wrap:anywhere]">{a.title}</span>
                          {a.instructions ? <span className="block truncate text-meta text-text-secondary">{a.instructions}</span> : null}
                        </span>
                        <span aria-hidden="true" className="text-text-secondary transition-transform group-open:rotate-90">
                          ›
                        </span>
                      </summary>
                      <div className="border-t border-border px-4 py-4">
                        {isFeatured ? (
                          <p className="text-meta">
                            <a href="#featured-assignment" className="font-semibold text-primary hover:underline">
                              Shown in full above
                            </a>
                          </p>
                        ) : planDetails ? (
                          <AssignmentBody a={a} canNote headingLevel="h4" />
                        ) : (
                          <Link href={`/reading/assignments/${a.id}`} className="font-semibold text-primary hover:underline">
                            Open this assignment
                          </Link>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        {/* 6 · Private notes (My Journal), linked to the book or one assignment. */}
        <section aria-labelledby="notes-heading" id="notes" className="scroll-mt-24">
          <SectionHeading id="notes-heading">My private notes</SectionHeading>
          <PrivateNotes
            bookId={id}
            notes={plan.notes}
            assignments={(shown?.assignments ?? []).map((a) => ({ id: a.id, label: `${a.title}${a.starts_on ? ` (${assignmentDates(a)})` : ""}` }))}
            defaultTarget={selectedId ?? current?.id ?? null}
            assignmentNotes={planDetails}
          />
        </section>

        {item.attachments.some((a) => a.role === "video") ? (
          <section aria-labelledby="videos-heading">
            <SectionHeading id="videos-heading">Videos</SectionHeading>
            <VideoList attachments={item.attachments} title={item.title} itemId={item.id} />
          </section>
        ) : null}

        {files.length ? (
          <section aria-labelledby="files-heading">
            <SectionHeading id="files-heading">Handouts and resources</SectionHeading>
            <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
              {files.map((a) => (
                <FileRow key={`${a.role}-${a.asset_id}`} a={a} />
              ))}
            </ul>
          </section>
        ) : null}

        {item.related.length ? (
          <section aria-labelledby="related-heading">
            <SectionHeading id="related-heading">Related</SectionHeading>
            <ul className="space-y-3">
              {item.related.map((r) => (
                <li key={r.id}>
                  <ItemCard item={r} urls={urls} showKind />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {item.attribution ? <p className="text-meta text-text-secondary">{item.attribution}</p> : null}
      </article>
    </>
  );
}
