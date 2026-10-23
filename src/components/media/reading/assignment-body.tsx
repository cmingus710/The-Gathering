import { BookOpen, MessagesSquare, NotebookPen } from "lucide-react";
import Link from "next/link";
import { MarkdownBody } from "@/components/announcements/markdown-body";
import { formatDay } from "@/lib/media/format";
import type { PlanAssignment } from "@/lib/media/reading-plan";
import { FileRow } from "../content-detail";
import { CompleteToggle } from "../toggles";
import { VideoList } from "../video-list";

/** "Oct 1 – Oct 7, 2026", or the start date alone. */
export function assignmentDates(a: Pick<PlanAssignment, "starts_on" | "ends_on">): string {
  if (!a.starts_on) return "";
  if (!a.ends_on || a.ends_on === a.starts_on) return formatDay(a.starts_on, "short");
  const sameYear = a.starts_on.slice(0, 4) === a.ends_on.slice(0, 4);
  const start = sameYear ? formatDay(a.starts_on, "short").replace(/, \d{4}$/, "") : formatDay(a.starts_on, "short");
  return `${start} – ${formatDay(a.ends_on, "short")}`;
}

/**
 * One assignment's details and the member's own controls: the teacher's
 * instructions (the chapter or page range), notes, scripture, questions,
 * handouts, the discussion, "Mark as done", and "Write privately".
 */
export function AssignmentBody({ a, canNote, headingLevel = "h3" }: { a: PlanAssignment; canNote: boolean; headingLevel?: "h3" | "h4" }) {
  const H = headingLevel;
  const files = a.attachments.filter((f) => f.role !== "audio" && f.role !== "video");
  return (
    <div className="space-y-4">
      {a.instructions ? <p className="text-lg font-semibold leading-snug">{a.instructions}</p> : null}
      {a.summary && !a.body.trim() ? <p className="text-text-secondary">{a.summary}</p> : null}
      {a.body.trim() ? <MarkdownBody source={a.body} className="reading-body" /> : null}
      <VideoList attachments={a.attachments} title={a.title} itemId={a.id} />
      {a.scripture_refs.length ? (
        <ul aria-label="Scripture" className="flex flex-wrap gap-1.5">
          {a.scripture_refs.map((r) => (
            <li key={r} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-meta font-semibold text-primary">
              <BookOpen className="size-3.5" aria-hidden="true" />
              {r}
            </li>
          ))}
        </ul>
      ) : null}
      {a.questions.length ? (
        <div>
          <H className="mb-1.5 font-semibold">Discussion questions</H>
          <ol className="list-decimal space-y-1.5 pl-6">
            {a.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {files.length ? (
        <div>
          <H className="mb-1.5 font-semibold">Handouts and resources</H>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {files.map((f) => (
              <FileRow key={`${f.role}-${f.asset_id}`} a={f} />
            ))}
          </ul>
        </div>
      ) : null}
      {a.discussion ? (
        <Link href={`/community/t/${a.discussion.thread_id}`} className="interactive flex items-center gap-3 rounded-tile border border-border bg-surface px-4 py-3 hover:bg-surface-muted/60">
          <MessagesSquare className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Join the discussion</span>
            <span className="block truncate text-meta text-text-secondary">
              {a.discussion.title} · {a.discussion.replies} repl{a.discussion.replies === 1 ? "y" : "ies"}
            </span>
          </span>
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <CompleteToggle id={a.id} done={a.completed} label={a.title} />
        {canNote ? (
          <Link
            href={`/journal/new?item=${a.id}`}
            className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-border-strong/60 bg-surface px-4 font-semibold hover:bg-surface-muted"
          >
            <NotebookPen className="size-4" aria-hidden="true" />
            Write privately<span className="sr-only"> about {a.title}</span>
          </Link>
        ) : null}
      </div>
      <p className="text-meta text-text-secondary">Only you can see whether you marked it done. It doesn&apos;t change your place in the book.</p>
    </div>
  );
}
