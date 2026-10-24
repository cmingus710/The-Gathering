import { Download, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, SectionHeading } from "@/components/ui/card";
import { segmentClass, SegmentedTrack } from "@/components/ui/segmented";
import { requireLearner } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import type { JournalListItem } from "./actions";
import { DeleteAllForm } from "./delete-all";
import { JournalList } from "./search";

// A generic title: entry titles never appear in the browser tab or history.
export const metadata: Metadata = { title: "My Journal" };

export default async function JournalPage({ searchParams }: PageProps<"/journal">) {
  await requireLearner("/journal");
  const params = await searchParams;
  const status = params.view === "archived" ? "archived" : "active";
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("journal_entries", { p_query: null, p_status: status, p_limit: 30, p_offset: 0 });
  const r = (data ?? { total: 0, items: [] }) as { total: number; items: JournalListItem[] };

  return (
    <>
      <PageHeader
        title="My Journal"
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
      <SegmentedTrack label="Entries" className="mb-4">
        <Link href="/journal" className={segmentClass(status === "active")} aria-current={status === "active" ? "page" : undefined}>
          Entries
        </Link>
        <Link href="/journal?view=archived" className={segmentClass(status === "archived")} aria-current={status === "archived" ? "page" : undefined}>
          Archived
        </Link>
      </SegmentedTrack>
      <JournalList key={status} initial={r.items} total={r.total} status={status} />

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
