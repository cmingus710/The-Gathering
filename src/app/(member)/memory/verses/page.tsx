import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { MemoryNav } from "@/components/memory/nav";
import { StageBadge } from "@/components/memory/stage-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/memory/format";
import type { Card } from "@/lib/memory/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My Verses" };

export default async function MyVersesPage() {
  await requireApprovedMember("/memory/verses");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_cards");
  const cards = (data ?? { active: [], removed: [] }) as { active: Card[]; removed: Card[] };
  return (
    <>
      <PageHeader
        title="My Verses"
        description="Every verse you're memorizing, from collections or added yourself."
        actions={
          <ButtonLink href="/memory/verses/add" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
            Add a verse
          </ButtonLink>
        }
      />
      <MemoryNav current="verses" />
      {error ? <Alert tone="error" title="Your verses couldn't be loaded right now." className="mb-6" /> : null}
      {!error && !cards.active.length ? (
        <EmptyState glyph="memory" title="No verses yet" action={<ButtonLink href="/memory/collections" variant="secondary" size="sm">Browse collections</ButtonLink>}>
          Add a verse from a collection or choose one from the Bible.
        </EmptyState>
      ) : null}
      {cards.active.length ? (
        <ul className={rowListClass}>
          {cards.active.map((c) => (
            <li key={c.id}>
              <ListRow
                plain
                href={`/memory/verses/${c.id}`}
                label={`${c.passage.label} (${c.passage.translation.code})`}
                description={[c.item?.collection.title, c.due ? "Ready to review" : c.due_on ? `Next review ${formatDay(c.due_on)}` : null].filter(Boolean).join(" · ")}
                trailing={
                  <span className="flex items-center gap-2">
                    {c.update_available ? <Badge tone="warning">Updated text</Badge> : null}
                    <StageBadge stage={c.stage} />
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
      {cards.removed.length ? (
        <section aria-labelledby="removed" className="mt-8">
          <SectionHeading id="removed" description="Removed verses and earlier texts keep their practice history until you delete it.">
            Removed and earlier texts
          </SectionHeading>
          <ul className={rowListClass}>
            {cards.removed.map((c) => (
              <li key={c.id}>
                <ListRow plain href={`/memory/verses/${c.id}`} label={`${c.passage.label} (${c.passage.translation.code})`} description={c.status === "superseded" ? `Earlier text (version ${c.passage.version})` : "Removed"} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
