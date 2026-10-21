import type { Metadata } from "next";
import { FeaturedItem } from "@/components/media/featured-item";
import { ItemCard } from "@/components/media/item-card";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { coverPaths } from "@/lib/media/format";
import { signPaths } from "@/lib/media/storage";
import type { ItemCard as Card } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Church reading" };

type Reading = { today: string; current_books: Card[]; current_assignments: Card[]; recent_assignments: Card[]; past_books: Card[] };

const PROGRESS_LABEL = { want: "Want to read", reading: "Reading", finished: "Finished" } as const;
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
  const [{ data, error }, mine] = await Promise.all([supabase.rpc("media_reading"), supabase.rpc("media_books_progress")]);
  // The member's own book progress (Phase 13); absent before that migration is applied.
  const progress: MyProgress = new Map(
    ((mine.data as Array<{ item_id: string; status: keyof typeof PROGRESS_LABEL; position: string | null }> | null) ?? []).map((p) => [p.item_id, p]),
  );
  const r = (data ?? { current_books: [], current_assignments: [], recent_assignments: [], past_books: [] }) as Reading;
  const [lead, ...moreCurrent] = r.current_assignments;
  const urls = await signPaths(supabase, [
    ...coverPaths(lead ? [lead] : [], "large"),
    ...coverPaths([...moreCurrent, ...r.current_books, ...r.recent_assignments, ...r.past_books]),
  ]);
  const empty = !error && !r.current_books.length && !r.current_assignments.length && !r.recent_assignments.length && !r.past_books.length;

  return (
    <>
      <PageHeader title="Church reading" description="What we're reading together, this week's assignment, and discussion." />
      {error ? <Alert tone="error" title="Church reading couldn't be loaded right now." className="mb-6" /> : null}
      {empty ? (
        <EmptyState glyph="reading" title="Nothing assigned yet">
          The current book and weekly readings will appear here.
        </EmptyState>
      ) : null}
      {lead ? (
        <section aria-label="This week's reading" className="mb-8">
          <FeaturedItem item={lead} urls={urls} eyebrow="This week's reading" />
        </section>
      ) : null}
      {moreCurrent.length ? (
        <section aria-labelledby="rd-current" className="mb-8">
          <SectionHeading id="rd-current">Also this week</SectionHeading>
          <List items={moreCurrent} urls={urls} />
        </section>
      ) : null}
      {r.current_books.length ? (
        <section aria-labelledby="rd-books" className="mb-8">
          <SectionHeading id="rd-books">{r.current_books.length > 1 ? "Current books" : "Current book"}</SectionHeading>
          <List items={r.current_books} urls={urls} progress={progress} />
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
