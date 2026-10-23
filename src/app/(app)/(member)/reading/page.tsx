import type { Metadata } from "next";
import { ItemCard } from "@/components/media/item-card";
import { CurrentBook, PROGRESS_LABEL } from "@/components/media/reading/current-book";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { coverPaths } from "@/lib/media/format";
import { currentAssignment } from "@/lib/media/reading-plan";
import { signPaths } from "@/lib/media/storage";
import type { ItemCard as Card } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Books" };

type Reading = { today: string; current_books: Card[]; current_assignments: Card[]; recent_assignments: Card[]; past_books: Card[] };

type MyProgress = Map<string, { status: keyof typeof PROGRESS_LABEL; position: string | null }>;

function List({ items, urls, progress }: { items: Card[]; urls: Map<string, string>; progress?: MyProgress }) {
  return (
    <ul className="space-y-3">
      {items.map((i) => {
        const p = progress?.get(i.id);
        return (
          <li key={i.id}>
            <ItemCard item={i} urls={urls} />
            {p ? (
              <p className="mt-1 px-1 text-meta text-text-secondary">
                <span className="sr-only">Your progress on {i.title}: </span>
                {PROGRESS_LABEL[p.status]}
                {p.position ? ` · ${p.position}` : ""}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default async function ReadingPage() {
  const supabase = await requireClient();
  // The member check also runs here (not only in the section layout, which a
  // prefetch may have rendered earlier), alongside the read-only queries.
  const [, { data, error }, mine] = await Promise.all([requireApprovedMember("/reading"), supabase.rpc("media_reading"), supabase.rpc("media_books_progress")]);
  // The member's own book progress (Phase 13); absent before that migration is applied.
  const progress: MyProgress = new Map(
    ((mine.data as Array<{ item_id: string; status: keyof typeof PROGRESS_LABEL; position: string | null }> | null) ?? []).map((p) => [p.item_id, p]),
  );
  const r = (data ?? { today: "", current_books: [], current_assignments: [], recent_assignments: [], past_books: [] }) as Reading;
  // Each current book's assignment for today (explicit book link; same date rule as the book page).
  const forBook = new Map(r.current_books.map((b) => [b.id, currentAssignment(r.current_assignments.filter((a) => a.book?.id === b.id), r.today)]));
  const shownWithBook = new Set([...forBook.values()].flatMap((a) => (a ? [a.id] : [])));
  const otherCurrent = r.current_assignments.filter((a) => !shownWithBook.has(a.id));
  const urls = await signPaths(supabase, [...coverPaths(r.current_books, "large"), ...coverPaths([...otherCurrent, ...r.recent_assignments, ...r.past_books])]);
  const empty = !error && !r.current_books.length && !r.current_assignments.length && !r.recent_assignments.length && !r.past_books.length;

  return (
    <>
      <PageHeader title="Books" description="What we're reading together, this week's assignment, and your own progress." />
      {error ? <Alert tone="error" title="Books couldn't be loaded right now." className="mb-6" /> : null}
      {empty ? (
        <EmptyState glyph="reading" title="No books yet">
          The current book and weekly readings will appear here.
        </EmptyState>
      ) : null}
      {r.current_books.length ? (
        <section aria-labelledby="rd-books" className="mb-8">
          <h2 id="rd-books" className="sr-only">
            {r.current_books.length > 1 ? "Current books" : "Current book"}
          </h2>
          <ul className="space-y-4">
            {r.current_books.map((b) => (
              <li key={b.id}>
                <CurrentBook book={b} assignment={forBook.get(b.id) ?? null} urls={urls} progress={progress.get(b.id)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {otherCurrent.length ? (
        <section aria-labelledby="rd-current" className="mb-8">
          <SectionHeading id="rd-current">{r.current_books.length ? "Also this week" : "This week's reading"}</SectionHeading>
          <List items={otherCurrent} urls={urls} />
        </section>
      ) : null}
      {r.recent_assignments.length ? (
        <section aria-labelledby="rd-recent" className="mb-8">
          <SectionHeading id="rd-recent">Other weeks</SectionHeading>
          <List items={r.recent_assignments} urls={urls} />
        </section>
      ) : null}
      {r.past_books.length ? (
        <section aria-labelledby="rd-past">
          <SectionHeading id="rd-past">Books we&apos;ve read</SectionHeading>
          <List items={r.past_books} urls={urls} progress={progress} />
        </section>
      ) : null}
    </>
  );
}
