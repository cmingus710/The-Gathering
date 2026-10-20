import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { MemoryNav } from "@/components/memory/nav";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import type { Collection } from "@/lib/memory/types";
import { signMemoryPaths } from "@/lib/memory/storage";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Verse collections" };

export default async function CollectionsPage() {
  await requireLearner("/memory/collections");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("memory_collections");
  const cols = (data ?? { church: [], personal: [] }) as { church: Collection[]; personal: Collection[] };
  const covers = await signMemoryPaths(supabase, cols.church.map((c) => c.cover_path));
  return (
    <>
      <PageHeader title="Verse collections" description="Sets of verses chosen by the church, your groups, or you." />
      <MemoryNav current="collections" />
      {error ? <Alert tone="error" title="Collections couldn't be loaded right now." className="mb-6" /> : null}
      <section aria-labelledby="church" className="mb-8">
        <SectionHeading id="church">From the church and your groups</SectionHeading>
        {cols.church.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {cols.church.map((c) => (
              <li key={c.id}>
                <Link href={`/memory/collections/${c.id}`} className="interactive flex h-full gap-3 rounded-card border border-border bg-surface p-3 hover:bg-surface-muted/60">
                  {c.cover_path && covers.get(c.cover_path) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; never through the image cache
                    <img src={covers.get(c.cover_path)} alt={c.cover_alt ?? ""} className="size-20 shrink-0 rounded-tile object-cover" />
                  ) : (
                    <span className="flex size-20 shrink-0 items-center justify-center rounded-tile bg-surface-muted" aria-hidden="true">
                      <TileIcon name="memory" className="size-12" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block font-semibold">{c.title}</span>
                    <span className="block text-meta text-text-secondary">
                      {c.item_count} {c.item_count === 1 ? "verse" : "verses"} · {c.translation.code}
                      {c.group_name ? ` · ${c.group_name}` : ""}
                    </span>
                    {c.practiced ? <span className="block text-meta text-text-secondary">You&apos;ve practiced {c.practiced}</span> : null}
                    {c.description ? <span className="mt-1 line-clamp-2 block text-meta">{c.description}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState glyph="memory" title="No collections yet">
            When the church publishes a verse collection, it appears here.
          </EmptyState>
        )}
      </section>
      <section aria-labelledby="personal">
        <SectionHeading
          id="personal"
          description="Only you can see these."
          action={
            <ButtonLink href="/memory/collections/new" variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
              New collection
            </ButtonLink>
          }
        >
          My collections
        </SectionHeading>
        {cols.personal.length ? (
          <ul className={rowListClass}>
            {cols.personal.map((c) => (
              <li key={c.id}>
                <ListRow plain href={`/memory/collections/${c.id}`} label={c.title} description={`${c.item_count} ${c.item_count === 1 ? "verse" : "verses"} · ${c.translation.code}`} trailing={<ChevronRight className="size-5" aria-hidden="true" />} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-secondary">Group your own verses into collections, for example by theme.</p>
        )}
      </section>
    </>
  );
}
