import { Download, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { segmentClass, SegmentedTrack } from "@/components/ui/segmented";
import { HighlightsView } from "@/components/journal/highlights-view";
import { requireLearner } from "@/lib/auth/viewer";
import { loadHighlightPassages, loadPassageTexts, refOf } from "@/lib/bible/highlight-passages";
import { requireClient } from "@/lib/supabase/server";
import type { JournalListItem } from "./actions";
import { DeleteAllForm } from "./delete-all";
import { JournalList } from "./search";

// A generic title: entry titles never appear in the browser tab or history.
export const metadata: Metadata = { title: "My Journal" };

export default async function JournalPage({ searchParams }: PageProps<"/journal">) {
  await requireLearner("/journal");
  const params = await searchParams;
  const highlightsView = params.view === "highlights";
  const status = params.view === "archived" ? "archived" : "active";
  const supabase = await requireClient();
  const [{ data, error }, highlights] = await Promise.all([
    highlightsView ? Promise.resolve({ data: null, error: null }) : supabase.rpc("journal_entries", { p_query: null, p_status: status, p_limit: 30, p_offset: 0 }),
    highlightsView ? loadHighlightPassages(supabase, { sort: "recent", limit: 20, offset: 0 }) : Promise.resolve(null),
  ]);
  const r = (data ?? { total: 0, items: [] }) as { total: number; items: JournalListItem[] };
  const texts = highlights?.ok ? await loadPassageTexts(supabase, highlights.page.items.filter((i) => i.translation.available).map(refOf)) : {};

  return (
    <>
      <SectionHeader
        section="journal"
        description="Private notes, reflections, and lesson answers. Only you can read them: not church staff, group leaders, or anyone in your household."
        actions={
          <ButtonLink href="/journal/new" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
            New entry
          </ButtonLink>
        }
      />
      {params.notice === "deleted" ? <Alert tone="success" title="The entry was deleted." className="mb-4" /> : null}
      {params.notice === "lesson-deleted" ? <Alert tone="success" title="Your answers and notes for that lesson were deleted." className="mb-4" /> : null}
      {error ? <Alert tone="error" title="Your journal couldn't be loaded right now." className="mb-4" /> : null}
      <SegmentedTrack label="My Journal views" className="mb-4">
        <Link href="/journal" className={segmentClass(!highlightsView && status === "active")} aria-current={!highlightsView && status === "active" ? "page" : undefined}>
          Entries
        </Link>
        <Link href="/journal?view=highlights" className={segmentClass(highlightsView)} aria-current={highlightsView ? "page" : undefined}>
          Scripture Highlights
        </Link>
        <Link href="/journal?view=archived" className={segmentClass(!highlightsView && status === "archived")} aria-current={!highlightsView && status === "archived" ? "page" : undefined}>
          Archived
        </Link>
      </SegmentedTrack>
      {highlightsView ? (
        <section aria-labelledby="journal-highlights">
          <h2 id="journal-highlights" className="sr-only">
            Scripture Highlights
          </h2>
          <p className="mb-4 text-meta text-text-secondary">
            Every verse you highlight in the Bible reader appears here automatically, grouped into passages. Changes here and in the reader stay in step. Removing a
            highlight never removes your journal entries or memory verses.
          </p>
          {highlights && !highlights.ok ? (
            <Alert tone="error" title={highlights.message} className="mb-4" />
          ) : highlights?.ok ? (
            <HighlightsView initial={highlights.page} initialTexts={texts} />
          ) : null}
        </section>
      ) : (
        <JournalList key={status} initial={r.items} total={r.total} status={status} />
      )}

      <section aria-labelledby="journal-data" className="mt-10 space-y-3">
        <SectionHeading id="journal-data" description="Your journal is stored in your church account so it's there on any device you sign in on. It isn't end-to-end encrypted.">
          Your journal data
        </SectionHeading>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/api/journal/export?scope=journal&format=md" variant="secondary" size="sm" icon={<Download className="size-4" aria-hidden="true" />}>
            Download (Markdown)
          </ButtonLink>
          <ButtonLink href="/api/journal/export?scope=all" variant="secondary" size="sm" icon={<Download className="size-4" aria-hidden="true" />}>
            Download everything (JSON)
          </ButtonLink>
        </div>
        <DeleteAllForm />
      </section>
    </>
  );
}
