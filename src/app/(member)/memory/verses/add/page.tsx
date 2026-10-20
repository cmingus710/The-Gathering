import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Attribution, ScriptureText } from "@/components/bible/scripture";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireLearner } from "@/lib/auth/viewer";
import { BOOK_LIST, chapterCount, isBookCode } from "@/lib/bible/books";
import type { Translation, Verse } from "@/lib/bible/types";
import { requireClient } from "@/lib/supabase/server";
import { AddPassageForm } from "./add-form";

export const metadata: Metadata = { title: "Add a memory verse" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const int = (v: string) => (/^\d{1,3}$/.test(v) ? Number(v) : null);

type Preview = { ok: boolean; problem?: string; label?: string; translation?: Translation; verses?: Verse[] };

/**
 * Choose a passage from the approved Bible source, see its exact text, then
 * add it. Nothing is saved until "Add to My Verses". Only versions whose
 * text is stored here can be memorized (practice is checked against the
 * exact wording on the server).
 */
export default async function AddVersePage({ searchParams }: PageProps<"/memory/verses/add">) {
  await requireLearner("/memory/verses/add");
  const sp = await searchParams;
  const supabase = await requireClient();
  const { data: tData } = await supabase.rpc("bible_translations");
  const versions = (tData as { default_id: string | null; preferred_id: string | null; items: Translation[] } | null) ?? { default_id: null, preferred_id: null, items: [] };
  const stored = versions.items.filter((t) => t.source_kind === "database");
  const t = one(sp.t) || versions.preferred_id || versions.default_id || stored[0]?.id || "";
  const book = one(sp.book);
  const chapter = int(one(sp.c));
  const from = int(one(sp.from));
  const to = int(one(sp.to)) ?? from;
  let preview: Preview | null = null;
  if (t && isBookCode(book) && chapter && from && to) {
    const { data, error } = await supabase.rpc("memory_passage_preview", { p_translation: t, p: { book, sc: chapter, sv: from, ec: chapter, ev: to } });
    preview = error ? { ok: false, problem: error.code === "22023" ? error.message : "That passage couldn't be checked right now." } : (data as Preview);
  }
  return (
    <>
      <Link href="/memory/verses" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> My Verses
      </Link>
      <PageHeader title="Add a memory verse" description="Choose a passage from the church's Bible versions. You'll see its exact text before adding it." />
      {!stored.length ? (
        <Alert tone="info" title="No Bible version is available for memory practice yet.">
          Memory practice needs a version whose text is stored by the church. Ask an administrator to set one up.
        </Alert>
      ) : (
        <div className="space-y-6">
          <Card>
            <form method="get" className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Bible version" name="t" defaultValue={t}>
                {stored.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.code})
                  </option>
                ))}
              </SelectField>
              <SelectField label="Book" name="book" defaultValue={isBookCode(book) ? book : "JHN"}>
                {BOOK_LIST.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </SelectField>
              <TextField label="Chapter" name="c" inputMode="numeric" pattern="\d{1,3}" defaultValue={chapter ? String(chapter) : ""} required hint={isBookCode(book) ? `1 to ${chapterCount(book)}` : undefined} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="From verse" name="from" inputMode="numeric" pattern="\d{1,3}" defaultValue={from ? String(from) : ""} required />
                <TextField label="To verse" name="to" inputMode="numeric" pattern="\d{1,3}" defaultValue={to ? String(to) : ""} hint="Up to 30 verses" optional />
              </div>
              <div className="sm:col-span-2">
                <SubmitButton variant="secondary">Show the passage</SubmitButton>
              </div>
            </form>
          </Card>
          {preview && !preview.ok ? <Alert tone="error" title={preview.problem ?? "That passage can't be used."} /> : null}
          {preview?.ok && preview.verses && preview.translation ? (
            <Card>
              <h2 className="mb-3 font-display text-[1.375rem] font-semibold">
                {preview.label} <span className="text-text-secondary">({preview.translation.code})</span>
              </h2>
              <ScriptureText verses={preview.verses} translation={preview.translation} label={`${preview.label} (${preview.translation.code})`} />
              <Attribution translation={preview.translation} />
              <div className="mt-4">
                <AddPassageForm translation={t} book={book} chapter={chapter!} from={from!} to={to!} />
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
