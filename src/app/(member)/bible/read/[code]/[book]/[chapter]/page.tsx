import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readerPrefsAction } from "@/app/(member)/bible/actions";
import { ChapterReader } from "@/components/bible/chapter-reader";
import { FumsTracker } from "@/components/bible/fums";
import { Attribution } from "@/components/bible/scripture";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { requireLearner } from "@/lib/auth/viewer";
import { resolveText } from "@/lib/bible/source";
import type { ChapterPayload, Translation } from "@/lib/bible/types";
import { requireClient } from "@/lib/supabase/server";
import { ChapterPicker } from "./picker";

export const metadata: Metadata = { title: "Bible" };

export default async function ChapterPage({ params }: PageProps<"/bible/read/[code]/[book]/[chapter]">) {
  const { code, book, chapter } = await params;
  const ch = Number(chapter);
  if (!/^[A-Z0-9-]{2,16}$/.test(code) || !/^[1-3A-Z][A-Z0-9]{2}$/.test(book) || !Number.isInteger(ch) || ch < 1 || ch > 150) notFound();
  await requireLearner(`/bible/read/${code}/${book}/${ch}`);
  const supabase = await requireClient();
  const { data: list } = await supabase.rpc("bible_translations");
  const translations = ((list as { items: Translation[] } | null)?.items ?? []) as Translation[];
  const translation = translations.find((t) => t.code === code);
  if (!translation) notFound();

  const [{ data, error }, books, highlights, prefs] = await Promise.all([
    supabase.rpc("bible_chapter", { p_translation: translation.id, p_book: book, p_chapter: ch }),
    supabase.rpc("bible_books", { p_translation: translation.id }),
    supabase.rpc("bible_highlights", { p_translation: translation.id, p_book: book, p_chapter: ch }),
    supabase.rpc("bible_reader_prefs"),
  ]);
  if (error?.code === "P0002") notFound();
  const payload = data as ChapterPayload | null;
  const text = payload ? await resolveText(payload.translation, payload.verses, payload.provider, { book, sc: ch, sv: null, ec: ch, ev: null }) : null;
  const bookList = (books.data as Array<{ code: string; name: string; chapters: number }> | null) ?? [];
  const p = (prefs.data as { text_size: number; line_spacing: number; verse_numbers: boolean } | null) ?? { text_size: 100, line_spacing: 1.7, verse_numbers: true };

  // Switching translation keeps the place when that translation has it.
  const switchTo = async (formData: FormData) => {
    "use server";
    const target = translations.find((t) => t.code === String(formData.get("translation") ?? ""));
    if (!target) return;
    await readerPrefsAction({ translation_id: target.id });
    redirect(`/bible/read/${target.code}/${book}/${ch}`);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/bible" className="font-semibold text-primary hover:underline">
          Bible reading
        </Link>
        {translations.length > 1 ? (
          <form action={switchTo} className="flex items-center gap-2">
            <label htmlFor="translation" className="text-meta text-text-secondary">
              Translation
            </label>
            <select id="translation" name="translation" defaultValue={translation.code} className="min-h-11 rounded-control border border-border-strong bg-surface px-3">
              {translations.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.code} · {t.name}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-11 rounded-full border border-border-strong px-4 font-semibold">
              Go
            </button>
          </form>
        ) : null}
      </div>

      {payload ? (
        <>
          <h1 className="font-display text-display font-semibold">
            {payload.book.name} {payload.chapter}
          </h1>
          <p className="mb-4 text-meta text-text-secondary">
            {translation.name} ({translation.code})
          </p>
          <ChapterPicker code={translation.code} books={bookList} book={book} chapter={ch} />
        </>
      ) : null}

      {error || !payload ? (
        <Alert tone="error" title="This chapter couldn't be loaded right now." />
      ) : text?.status === "unavailable" ? (
        <Alert tone="warning" title="This chapter isn't available right now.">
          {text.reason === "outage"
            ? "The scripture source isn't responding. Try again in a little while. No other translation or saved copy is shown in its place."
            : "This translation's source isn't set up, so its text can't be shown."}
        </Alert>
      ) : text?.status === "ok" ? (
        <ChapterReader
          key={`${translation.id}:${book}:${ch}`}
          translation={payload.translation}
          book={book}
          bookName={payload.book.name}
          chapter={ch}
          verses={text.verses}
          initialHighlights={(highlights.data as Array<{ verse: number; color: string }> | null) ?? []}
          prefs={p}
        />
      ) : null}

      {payload ? (
        <>
          <Attribution translation={payload.translation} extra={text?.status === "ok" ? text.copyright : null} />
          <nav aria-label="Chapters" className="mt-6 flex justify-between gap-3">
            {payload.prev ? (
              <ButtonLink href={`/bible/read/${translation.code}/${payload.prev.book}/${payload.prev.chapter}`} variant="ghost" size="sm" icon={<ChevronLeft className="size-4" aria-hidden="true" />}>
                {payload.prev.name} {payload.prev.chapter}
              </ButtonLink>
            ) : (
              <span />
            )}
            {payload.next ? (
              <ButtonLink href={`/bible/read/${translation.code}/${payload.next.book}/${payload.next.chapter}`} variant="ghost" size="sm">
                {payload.next.name} {payload.next.chapter} <ChevronRight className="size-4" aria-hidden="true" />
              </ButtonLink>
            ) : null}
          </nav>
        </>
      ) : null}
      {text?.status === "ok" && text.fumsId ? <FumsTracker ids={[text.fumsId]} /> : null}
    </>
  );
}
