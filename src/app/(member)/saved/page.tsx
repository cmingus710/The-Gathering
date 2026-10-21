import type { Metadata } from "next";
import Link from "next/link";
import { ItemCard } from "@/components/media/item-card";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, PageHeader, rowListClass, SectionHeading } from "@/components/ui/card";
import { coverPaths } from "@/lib/media/format";
import { clearListeningHistoryAction } from "@/lib/media/member-actions";
import { signPaths } from "@/lib/media/storage";
import type { ItemCard as Card } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Saved" };

type Saved = { items: Card[]; shows: Array<{ id: string; title: string; kind: string; author: string | null }> };

/**
 * The member's own bookmarks and listening history. Nobody else (staff
 * included) can see them; only content the member can still see is listed.
 */
export default async function SavedPage() {
  const supabase = await requireClient();
  const [saved, cont] = await Promise.all([supabase.rpc("media_bookmarks"), supabase.rpc("media_continue")]);
  const s = (saved.data ?? { items: [], shows: [] }) as Saved;
  const resume = (cont.data ?? []) as Card[];
  const urls = await signPaths(supabase, coverPaths([...s.items, ...resume]));

  return (
    <>
      <PageHeader title="Saved" description="Teaching you saved for later and where you left off. Only you can see this page." />
      {saved.error ? <Alert tone="error" title="Your saved items couldn't be loaded right now." className="mb-6" /> : null}

      {resume.length ? (
        <section aria-labelledby="sv-continue" className="mb-8">
          <SectionHeading id="sv-continue">Continue listening and watching</SectionHeading>
          <ul className="space-y-3">
            {resume.map((i) => (
              <li key={i.id}>
                <ItemCard item={i} urls={urls} showKind />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="sv-items" className="mb-8">
        <SectionHeading id="sv-items">Saved for later</SectionHeading>
        {s.items.length ? (
          <ul className="space-y-3">
            {s.items.map((i) => (
              <li key={i.id}>
                <ItemCard item={i} urls={urls} showKind />
              </li>
            ))}
          </ul>
        ) : !saved.error ? (
          <EmptyState glyph="media" title="Nothing saved yet">
            Use Save on a devotional, lesson, episode, or reading to find it here.
          </EmptyState>
        ) : null}
      </section>

      {s.shows.length ? (
        <section aria-labelledby="sv-shows" className="mb-8">
          <SectionHeading id="sv-shows">Saved podcasts</SectionHeading>
          <ul className={rowListClass}>
            {s.shows.map((sh) => (
              <li key={sh.id}>
                <Link href={`/podcasts/shows/${sh.id}`} className="flex min-h-14 flex-col justify-center px-4 py-2.5 hover:bg-surface-muted/60">
                  <span className="font-semibold">{sh.title}</span>
                  <span className="text-meta text-text-secondary">{sh.kind === "church" ? "From our church" : sh.author || "Podcast"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="sv-history" className="rounded-card border border-border bg-surface p-5">
        <h2 id="sv-history" className="font-semibold">
          Listening history
        </h2>
        <p className="mt-1 text-meta text-text-secondary">
          The app remembers where you stopped so you can pick up again. It&apos;s private to you and isn&apos;t shown to church staff. Clearing it forgets
          every saved position; your bookmarks stay.
        </p>
        <div className="mt-3">
          <ConfirmDialog trigger="Clear listening history" title="Clear listening history?" confirmLabel="Clear history" formAction={clearListeningHistoryAction}>
            Every saved position is forgotten. Your bookmarks stay. This can&apos;t be undone.
          </ConfirmDialog>
        </div>
      </section>
    </>
  );
}
