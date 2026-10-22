import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookReadingView, type BookExtras, type BookPlanData } from "@/components/media/reading/book-reading-view";
import { isUuid } from "@/lib/media/format";
import { loadItemPage } from "@/lib/media/pages";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Church reading" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

/**
 * The church reading page for one book: the book, Audible/Kindle links, the
 * member's own place in the book, the reading plan's current assignment and
 * full schedule (each with its own "Mark as done"), and private notes.
 * /reading/assignments/<id> redirects here with ?assignment=<id>.
 *
 * Book-level progress (media.book_progress) and assignment completion
 * (media.completions) are separate records; neither changes the other.
 * Assignments belong to the book through their explicit book link; a book's
 * assignments for one audience (church-wide, or one group) form one plan.
 */
export default async function BookReadingPage({ params, searchParams }: PageProps<"/reading/books/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const supabase = await requireClient();
  const page = await loadItemPage(supabase, id, ["book"]);
  if (!page) notFound();

  const [extrasRes, planRes] = await Promise.all([supabase.rpc("media_book_extras", { p_item: id }), supabase.rpc("media_reading_plan", { p_book: id })]);
  const extras = (extrasRes.data as BookExtras | null) ?? null;
  let plan = planRes.error ? null : (planRes.data as BookPlanData | null);
  // Before 20261104000100 is applied: the schedule from the book's cards
  // (no per-assignment details, one plan) and no notes list.
  const planDetails = !!plan;
  if (!plan) {
    const { data } = await supabase.rpc("media_reading");
    const cards = [...(page.item.assignments ?? [])].sort((x, y) => (x.starts_on ?? "").localeCompare(y.starts_on ?? ""));
    plan = {
      today: (data as { today?: string } | null)?.today ?? new Date().toISOString().slice(0, 10),
      assignments: cards.map((c) => ({ ...c, instructions: null, questions: [], body: "", group_id: null, group_name: null, attachments: [], discussion: null })),
      notes: [],
    };
  }
  return (
    <BookReadingView
      item={page.item}
      urls={page.urls}
      extras={extras}
      plan={plan}
      planDetails={planDetails}
      requestedAssignment={one(sp.assignment)}
      requestedPlan={one(sp.plan)}
    />
  );
}
