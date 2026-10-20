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

function List({ items, urls }: { items: Card[]; urls: Map<string, string> }) {
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.id}>
          <ItemCard item={i} urls={urls} />
        </li>
      ))}
    </ul>
  );
}

export default async function ReadingPage() {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_reading");
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
          <List items={r.current_books} urls={urls} />
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
          <List items={r.past_books} urls={urls} />
        </section>
      ) : null}
    </>
  );
}
