import { Bookmark, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import { requireClient } from "@/lib/supabase/server";
import { clearAnnotationsAction, removeBookmarkAction } from "../actions";

export const metadata: Metadata = { title: "Bookmarks" };

type Bm = {
  id: string;
  kind: "passage" | "assignment";
  available: boolean;
  reference: string | null;
  translation_code: string | null;
  book: string | null;
  chapter: number | null;
  day: { id: string; label: string; plan_title: string } | null;
  created_at: string;
};

export default async function BookmarksPage() {
  await requireLearner("/bible/bookmarks");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_bookmarks");
  const items = (data as Bm[] | null) ?? [];
  const href = (b: Bm) =>
    b.kind === "passage" ? `/bible/read/${b.translation_code}/${b.book}/${b.chapter}` : b.day ? `/bible/day/${b.day.id}` : null;

  return (
    <>
      <BackLink route="/bible/bookmarks" />
      <PageHeader title="Bookmarks and highlights" description="Private to you. Highlights appear in the reader." />
      {error ? <Alert tone="error" title="Bookmarks couldn't be loaded right now." className="mb-6" /> : null}
      {items.length ? (
        <ul className={`${rowListClass} mb-8`}>
          {items.map((b) => {
            const link = b.available ? href(b) : null;
            const label = b.kind === "passage" ? `${b.reference} (${b.translation_code})` : b.day ? `${b.day.plan_title}: ${b.day.label}` : "A reading that's no longer available";
            return (
              <li key={b.id} className="flex items-center gap-3 px-4 py-2">
                <Bookmark className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {link ? (
                    <Link href={link} className="font-semibold hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <span className="font-semibold text-text-secondary">{label}</span>
                  )}
                  {!b.available ? <span className="block text-meta text-text-secondary">No longer available</span> : null}
                </span>
                <form action={removeBookmarkAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button type="submit" className="flex size-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-muted" aria-label={`Remove bookmark: ${label}`}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      ) : !error ? (
        <EmptyState glyph="bible" title="No bookmarks yet" className="mb-8">
          In the reader, select verse numbers to bookmark or highlight them.
        </EmptyState>
      ) : null}

      <section aria-labelledby="your-data">
        <SectionHeading id="your-data" description="Download or remove your reading data at any time.">
          Your data
        </SectionHeading>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/api/journal/export?scope=reading" variant="secondary" size="sm">
            Download my reading data (JSON)
          </ButtonLink>
          <ConfirmDialog trigger="Remove all bookmarks" title="Remove all bookmarks?" confirmLabel="Remove all" formAction={clearAnnotationsAction} hidden={{ kind: "bookmarks" }}>
            This can&apos;t be undone.
          </ConfirmDialog>
          <ConfirmDialog trigger="Remove all highlights" title="Remove all highlights?" confirmLabel="Remove all" formAction={clearAnnotationsAction} hidden={{ kind: "highlights" }}>
            This removes every highlight in every translation. It can&apos;t be undone.
          </ConfirmDialog>
        </div>
      </section>
    </>
  );
}
