import { BookOpen, Bookmark, Highlighter, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, SectionHeading, rowListClass } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { requireLearner } from "@/lib/auth/viewer";
import { readerHref } from "@/lib/bible/highlights";
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
  start_verse: number | null;
  end_verse: number | null;
  day: { id: string; label: string; plan_title: string } | null;
  created_at: string;
};

export default async function BookmarksPage() {
  await requireLearner("/bible/bookmarks");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_bookmarks");
  const items = (data as Bm[] | null) ?? [];
  // A passage opens the reader at its first verse with the passage outlined.
  const href = (b: Bm) =>
    b.kind === "passage" && b.translation_code && b.book && b.chapter
      ? readerHref({ code: b.translation_code, book: b.book, chapter: b.chapter, start: b.start_verse, end: b.start_verse ? (b.end_verse ?? b.start_verse) : null })
      : b.day
        ? `/bible/day/${b.day.id}`
        : null;
  const added = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

  return (
    <>
      <BackLink route="/bible/bookmarks" />
      <SectionHeader
        section="bible"
        size="compact"
        title="Bookmarks"
        description="Private to you. Select verses in the reader and choose Bookmark; come back here to pick up where you left off."
      />
      {error ? <Alert tone="error" title="Bookmarks couldn't be loaded right now." className="mb-6" /> : null}
      {items.length ? (
        <ul className={`${rowListClass} mb-8`}>
          {items.map((b) => {
            const link = b.available ? href(b) : null;
            const label = b.kind === "passage" ? `${b.reference} (${b.translation_code})` : b.day ? `${b.day.plan_title}: ${b.day.label}` : "A reading that's no longer available";
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <Bookmark className="size-5 shrink-0 fill-current text-primary" aria-hidden="true" />
                <span className="min-w-[min(100%,14rem)] flex-1">
                  <span className={`block font-semibold ${link ? "" : "text-text-secondary"}`}>{label}</span>
                  <span className="block text-meta text-text-secondary">{b.available ? `Added ${added(b.created_at)}` : "No longer available"}</span>
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {link ? (
                    <ButtonLink href={link} size="sm" icon={<BookOpen className="size-4" aria-hidden="true" />} aria-label={`Continue reading at ${label}`}>
                      Continue reading
                    </ButtonLink>
                  ) : null}
                  <form action={removeBookmarkAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="flex size-11 items-center justify-center rounded-full text-text-secondary hover:bg-surface-muted" aria-label={`Remove bookmark: ${label}`}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </form>
                </span>
              </li>
            );
          })}
        </ul>
      ) : !error ? (
        <EmptyState glyph="bible" title="No bookmarks yet" className="mb-8">
          In the reader, select a verse or a range of verses and choose Bookmark. It&apos;ll appear here so you can pick up where you left off.
        </EmptyState>
      ) : null}

      <p className="mb-8 text-meta text-text-secondary">
        <Highlighter className="mr-1 inline size-4 align-text-bottom" aria-hidden="true" />
        Looking for highlights? They&apos;re in{" "}
        <Link href="/journal?view=highlights" className="font-semibold text-primary underline">
          My Journal → Scripture Highlights
        </Link>
        .
      </p>

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
