import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { bookByCode } from "@/lib/bible/books";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { discardImportAction } from "../../actions";
import { IssueList, PublishForm, type Issue } from "./review-forms";

export const metadata: Metadata = { title: "Review import" };

type Review = {
  id: string;
  status: "uploading" | "processing" | "staged" | "failed" | "published" | "discarded";
  format: string;
  original_name: string;
  rows_staged: number;
  error: string | null;
  summary: Record<string, number>;
  translation: { id: string; code: string; name: string; status: string; verse_count: number };
  books: Array<{ code: string; name: string; chapters: number }>;
  issues: Issue[];
  missing: Array<{ book: string; chapter: number; verse: number }> | null;
  review_note: string | null;
};

type Staged = { line: number; verse: number; text: string; heading: string | null; source_ref: string; issue: string | null; accepted: boolean };

/**
 * The review boundary: nothing here is visible to members. Shows the summary,
 * every flagged line with its source reference, verses the reference
 * numbering expects but the file lacks, and the staged text of any chapter.
 */
export default async function ImportReviewPage({ params, searchParams }: PageProps<"/admin/bible/sources/imports/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireCapability(CAPABILITIES.bibleManage, `/admin/bible/sources/imports/${id}`);
  const sp = await searchParams;
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_admin_import", { p_id: id, p_issue: null, p_limit: 500, p_offset: 0 });
  if (error?.code === "P0002") notFound();
  if (error || !data) return <Alert tone="error" title="This import couldn't be loaded right now." />;
  const r = data as Review;
  const s = r.summary ?? {};
  const book = typeof sp.book === "string" && bookByCode(sp.book) ? sp.book : (r.books[0]?.code ?? null);
  const chapter = typeof sp.chapter === "string" && /^\d{1,3}$/.test(sp.chapter) ? Number(sp.chapter) : 1;
  const staged = r.status === "staged" && book ? (((await supabase.rpc("bible_admin_import_chapter", { p_id: id, p_book: book, p_chapter: chapter })).data as Staged[] | null) ?? []) : [];
  // From the summary, so it's right even when more lines are flagged than listed.
  const undecided = (s.malformed ?? 0) + (s.unknown_book ?? 0) + (s.out_of_range ?? 0) + (s.empty ?? 0) - (s.accepted ?? 0);
  const canPublish = r.status === "staged" && !s.duplicate && undecided === 0;

  return (
    <>
      <p className="mb-4">
        <Link href={`/admin/bible/sources/${r.translation.id}`} className="font-semibold text-primary hover:underline">
          {r.translation.code} · {r.translation.name}
        </Link>
      </p>
      <PageHeader title="Review import" description={`${r.original_name} (${r.format.toUpperCase()}). Staged text is visible only here until you publish it.`} />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={r.status === "published" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{r.status}</Badge>
      </div>
      {r.error ? <Alert tone="error" title={r.error} className="mb-6" /> : null}

      {r.status === "staged" || r.status === "published" ? (
        <Card className="mb-6">
          <SectionHeading as="h2">Summary</SectionHeading>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-meta sm:grid-cols-4">
            {[
              ["Lines", s.lines],
              ["Ready verses", s.verses],
              ["Books", s.books],
              ["No text", s.empty],
              ["Beyond numbering", s.out_of_range],
              ["Couldn't read", s.malformed],
              ["Unknown book", s.unknown_book],
              ["Duplicates", s.duplicate],
              ["Missing verses", s.missing],
              ["Decided", s.accepted],
            ].map(([label, n]) => (
              <div key={String(label)}>
                <dt className="text-text-secondary">{label}</dt>
                <dd className="text-title font-semibold tabular-nums">{Number(n ?? 0).toLocaleString("en-US")}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

      {r.issues.length ? (
        <section aria-labelledby="flagged" className="mb-6">
          <SectionHeading id="flagged" description="Nothing here is guessed or repaired. Decide each line, or fix the source file and import it again.">
            Flagged lines
          </SectionHeading>
          <IssueList importId={r.id} issues={r.issues} editable={r.status === "staged"} />
        </section>
      ) : null}

      {r.missing?.length ? (
        <section aria-labelledby="missing" className="mb-6">
          <SectionHeading id="missing" description="Verses the usual numbering expects in the chapters this file covers, that no line provides.">
            Missing verses
          </SectionHeading>
          <p className="text-meta">{r.missing.map((m) => `${m.book} ${m.chapter}:${m.verse}`).join(", ")}{(s.missing ?? 0) > r.missing.length ? ` and ${s.missing - r.missing.length} more` : ""}</p>
        </section>
      ) : null}

      {r.status === "staged" && r.books.length ? (
        <section aria-labelledby="staged" className="mb-6">
          <SectionHeading id="staged">Staged text</SectionHeading>
          <form className="mb-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-meta text-text-secondary">
              Book
              <select name="book" defaultValue={book ?? ""} className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-base text-text">
                {r.books.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-meta text-text-secondary">
              Chapter
              <input name="chapter" type="number" min={1} max={150} defaultValue={chapter} className="min-h-11 w-24 rounded-control border border-border-strong bg-surface px-3 text-base text-text" />
            </label>
            <button type="submit" className="min-h-11 rounded-full border border-border-strong px-4 font-semibold">
              Show
            </button>
          </form>
          {staged.length ? (
            <ol className="space-y-2 rounded-card border border-border bg-surface p-4 font-serif">
              {staged.map((v) => (
                <li key={v.line} className={v.issue && !v.accepted ? "text-danger" : undefined}>
                  {v.heading ? <p className="font-sans text-meta italic text-text-secondary">{v.heading}</p> : null}
                  <sup className="mr-1 font-sans font-bold text-primary">{v.verse}</sup>
                  <span className="whitespace-pre-line">{v.text || "(no text)"}</span>
                  <span className="ml-2 font-sans text-[0.75rem] text-text-secondary">{v.source_ref}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-meta text-text-secondary">No staged lines for that chapter.</p>
          )}
        </section>
      ) : null}

      {r.status === "staged" ? (
        <Card className="mb-6">
          <SectionHeading as="h2">Publish</SectionHeading>
          {canPublish ? (
            <PublishForm importId={r.id} code={r.translation.code} missing={s.missing ?? 0} />
          ) : (
            <p className="text-meta text-text-secondary">{s.duplicate ? "Some verses appear more than once. Correct the file and import it again." : `Decide the ${undecided} flagged line${undecided === 1 ? "" : "s"} first.`}</p>
          )}
        </Card>
      ) : null}
      {r.status === "published" && r.review_note ? <p className="mb-6 text-meta text-text-secondary">Review note: {r.review_note}</p> : null}

      {["staged", "failed", "uploading", "processing"].includes(r.status) ? (
        <form action={discardImportAction}>
          <input type="hidden" name="import_id" value={r.id} />
          <button type="submit" className="min-h-11 font-semibold text-danger hover:underline">
            Discard this import
          </button>
        </form>
      ) : null}
    </>
  );
}
