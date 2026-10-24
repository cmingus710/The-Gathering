import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import { isBookCode } from "@/lib/bible/books";
import type { Translation } from "@/lib/bible/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bible" };

/**
 * Opens the member's preferred (or the church's default) translation, at a
 * book and chapter when asked (?b=PSA&c=39, from a devotional's Scripture
 * reference), else at John 1. The translation's own rules apply in the reader.
 */
export default async function ReadPage({ searchParams }: PageProps<"/bible/read">) {
  await requireLearner("/bible/read");
  const sp = await searchParams;
  const wantBook = typeof sp.b === "string" && isBookCode(sp.b) ? sp.b : null;
  const wantChapter = typeof sp.c === "string" && /^\d{1,3}$/.test(sp.c) ? Number(sp.c) : 1;
  const supabase = await requireClient();
  const { data } = await supabase.rpc("bible_translations");
  const t = data as { default_id: string | null; preferred_id: string | null; items: Translation[] } | null;
  const chosen = t?.items.find((x) => x.id === t.preferred_id) ?? t?.items.find((x) => x.id === t.default_id) ?? t?.items[0];
  if (chosen) {
    const books = await supabase.rpc("bible_books", { p_translation: chosen.id });
    const list = (books.data as Array<{ code: string; chapters?: number }> | null) ?? [];
    const wanted = wantBook ? list.find((b) => b.code === wantBook) : undefined;
    if (wanted && wantChapter >= 1 && (!wanted.chapters || wantChapter <= wanted.chapters)) redirect(`/bible/read/${chosen.code}/${wanted.code}/${wantChapter}`);
    const start = list.find((b) => b.code === "JHN") ?? list[0];
    if (start) redirect(`/bible/read/${chosen.code}/${start.code}/1`);
  }
  return (
    <>
      <BackLink route="/bible/read" />
      <PageHeader title="Bible" />
      <EmptyState glyph="bible" title="No Bible text is available yet">
        The church hasn&apos;t set up a translation for reading in the app.
      </EmptyState>
    </>
  );
}
