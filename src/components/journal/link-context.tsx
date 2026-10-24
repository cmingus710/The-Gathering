import { BookOpen, CalendarDays, GraduationCap, NotebookPen, Sunrise } from "lucide-react";
import Link from "next/link";
import { formatDay } from "@/lib/media/format";

export type EntryLink =
  | { kind: "passage"; label: string | null; translation_code: string | null; book: string; chapter: number; available: boolean }
  | { kind: "assignment"; available: boolean; day_id: string | null; label: string | null; plan_title: string | null; question: string | null; revision: number | null; changed_since: boolean; passages: Array<{ label: string }> | null }
  | { kind: "devotional" | "lesson" | "book" | "book_assignment"; available: boolean; item_id: string | null; title: string | null }
  // Lesson answers and notes (20261120000100), written while following a lesson.
  | {
      kind: "lesson_answer";
      available: boolean;
      item_id: string | null;
      title: string | null;
      question: string | null;
      block_id: string | null;
      state: "current" | "changed" | "removed";
    }
  | { kind: "lesson_notes"; available: boolean; item_id: string | null; title: string | null }
  | {
      kind: "collection_reading";
      available: boolean;
      reading_id: string | null;
      reading_date: string;
      collection_key: string | null;
      title: string | null;
      label: string | null;
      scripture_ref: string | null;
    };

const ITEM_HREF = { devotional: "/devotionals/", lesson: "/lessons/", book: "/reading/books/", book_assignment: "/reading/assignments/" } as const;
const ITEM_NAME = { devotional: "devotional", lesson: "Sunday lesson", book: "book", book_assignment: "reading assignment" } as const;

/**
 * What an entry is about. Linked teaching or plan days are named only while
 * the member can still open them; otherwise the note stays and the link
 * says it's no longer available.
 */
export function LinkContext({ link }: { link: EntryLink | null }) {
  if (!link) return null;
  const box = "mb-4 flex items-start gap-3 rounded-tile border border-border bg-surface px-4 py-3 text-meta";
  if (link.kind === "passage") {
    return (
      <div className={box}>
        <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <p>
          About{" "}
          {link.available ? (
            <Link href={`/bible/read/${link.translation_code}/${link.book}/${link.chapter}`} className="font-semibold text-primary hover:underline">
              {link.label} ({link.translation_code})
            </Link>
          ) : (
            <span className="font-semibold">{link.label}</span>
          )}
        </p>
      </div>
    );
  }
  if (link.kind === "assignment") {
    return (
      <div className={box}>
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div>
          {link.available && link.day_id ? (
            <p>
              About{" "}
              <Link href={`/bible/day/${link.day_id}`} className="font-semibold text-primary hover:underline">
                {link.plan_title}: {link.label}
              </Link>
              {link.passages?.length ? ` (${link.passages.map((p) => p.label).join("; ")})` : ""}
            </p>
          ) : (
            <p>About a reading plan day that&apos;s no longer available. Your note is kept.</p>
          )}
          {link.changed_since ? <p className="text-text-secondary">The plan has changed since you wrote this; the passages above are the ones you read.</p> : null}
          {link.question ? <p className="mt-1 font-semibold whitespace-pre-line [overflow-wrap:anywhere]">{link.question}</p> : null}
        </div>
      </div>
    );
  }
  if (link.kind === "lesson_answer" || link.kind === "lesson_notes") {
    // Back to the place in the lesson where this was written, while the member can open it.
    const href = link.available && link.item_id ? `/lessons/${link.item_id}/workbook${link.kind === "lesson_notes" ? "#wb-notes" : link.block_id ? `#q-${link.block_id}` : ""}` : null;
    return (
      <div className={box}>
        <NotebookPen className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          {href ? (
            <p>
              {link.kind === "lesson_notes" ? "Your notes on " : "Your answer in "}
              <Link href={href} className="font-semibold text-primary hover:underline">
                {link.title}
              </Link>
            </p>
          ) : (
            <p>About a Sunday lesson that&apos;s no longer available. Your {link.kind === "lesson_notes" ? "notes are" : "answer is"} kept.</p>
          )}
          {link.kind === "lesson_answer" && href && link.state === "changed" ? (
            <p className="text-text-secondary">The question has been reworded since you answered; open the lesson to see the new wording.</p>
          ) : null}
          {link.kind === "lesson_answer" && href && link.state === "removed" ? <p className="text-text-secondary">This question is no longer part of the lesson.</p> : null}
          {link.kind === "lesson_answer" && link.question ? <p className="mt-1 font-semibold whitespace-pre-line [overflow-wrap:anywhere]">{link.question}</p> : null}
        </div>
      </div>
    );
  }
  if (link.kind === "collection_reading") {
    // A reading from an imported collection (Morning & Evening), on the date reflected on.
    const when = formatDay(link.reading_date, "long");
    return (
      <div className={box}>
        <Sunrise className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        {link.available && link.reading_id && link.collection_key ? (
          <p>
            About{" "}
            <Link
              href={`/devotionals/collections/${encodeURIComponent(link.collection_key)}/readings/${link.reading_id}?on=${link.reading_date}`}
              className="font-semibold text-primary hover:underline"
            >
              {link.title}: {link.label}
            </Link>
            {link.scripture_ref ? ` (${link.scripture_ref})` : ""}, read {when}
          </p>
        ) : (
          <p>About a devotional reading for {when} that&apos;s no longer available. Your note is kept.</p>
        )}
      </div>
    );
  }
  return (
    <div className={box}>
      <GraduationCap className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      {link.available && link.item_id ? (
        <p>
          About{" "}
          <Link href={`${ITEM_HREF[link.kind]}${link.item_id}`} className="font-semibold text-primary hover:underline">
            {link.kind === "book_assignment" ? `Reading assignment: ${link.title}` : link.title}
          </Link>
        </p>
      ) : (
        <p>About a {ITEM_NAME[link.kind]} that&apos;s no longer available. Your note is kept.</p>
      )}
    </div>
  );
}
