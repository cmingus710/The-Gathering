import type { Metadata } from "next";
import { JournalEditor } from "@/components/journal/editor";
import { LinkContext, type EntryLink } from "@/components/journal/link-context";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { requireLearner } from "@/lib/auth/viewer";
import { isBookCode } from "@/lib/bible/books";
import { formatPassage } from "@/lib/bible/reference";
import type { Translation } from "@/lib/bible/types";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New journal entry" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const int = (v: string | undefined) => (v && /^\d{1,3}$/.test(v) ? Number(v) : null);

/**
 * A new entry, optionally about a passage (?t&b&c&sv&ev), a plan day and one
 * of its reflection questions (?day&q), or a devotional, lesson, church book, or
 * church reading assignment (?item).
 * The link is checked when the first save creates the entry.
 */
export default async function NewEntryPage({ searchParams }: PageProps<"/journal/new">) {
  await requireLearner("/journal/new");
  const sp = await searchParams;
  const supabase = await requireClient();
  let link: Record<string, string | number | null> | null = null;
  let context: EntryLink | null = null;
  let problem: string | null = null;

  const day = one(sp.day);
  const item = one(sp.item);
  const t = one(sp.t);
  const b = one(sp.b);
  if (day && isUuid(day)) {
    const { data, error } = await supabase.rpc("bible_day", { p_day: day });
    if (error || !data) problem = "That reading isn't available, so this entry won't be linked to it.";
    else {
      const d = data as { id: string; label: string; questions: string[]; plan: { title: string }; passages: Array<{ label: string }>; revision: number };
      const qi = int(one(sp.q));
      const question = qi !== null ? (d.questions[qi] ?? null) : null;
      link = { kind: "assignment", day_id: d.id, question };
      context = { kind: "assignment", available: true, day_id: d.id, label: d.label, plan_title: d.plan.title, question, revision: d.revision, changed_since: false, passages: d.passages };
    }
  } else if (item && isUuid(item)) {
    const { data, error } = await supabase.rpc("media_item", { p_id: item });
    const media = data as { id: string; kind: string; title: string } | null;
    if (error || !media || !["devotional", "lesson", "book", "assignment"].includes(media.kind)) problem = "That teaching isn't available, so this entry won't be linked to it.";
    else {
      // A church reading assignment links as 'book_assignment' ('assignment' is a Bible plan day).
      const kind = media.kind === "assignment" ? "book_assignment" : (media.kind as "devotional" | "lesson" | "book");
      link = { kind, media_item_id: media.id };
      context = { kind, available: true, item_id: media.id, title: media.title };
    }
  } else if (t && isUuid(t) && b && isBookCode(b)) {
    const c = int(one(sp.c));
    const sv = int(one(sp.sv));
    const ev = int(one(sp.ev)) ?? sv;
    const { data } = await supabase.rpc("bible_translations");
    const tr = ((data as { items: Translation[] } | null)?.items ?? []).find((x) => x.id === t);
    if (c && tr) {
      link = { kind: "passage", translation_id: t, book: b, chapter: c, start_verse: sv, end_verse: ev };
      context = { kind: "passage", label: formatPassage({ book: b, sc: c, sv, ec: c, ev }), translation_code: tr.code, book: b, chapter: c, available: true };
    } else problem = "That passage isn't available, so this entry won't be linked to it.";
  }

  return (
    <>
      <BackLink route="/journal/new" />
      <h1 className="sr-only">New journal entry</h1>
      {problem ? <Alert tone="warning" title={problem} className="mb-4" /> : null}
      <LinkContext link={context} />
      <JournalEditor entry={null} link={link} placeholder={context?.kind === "assignment" && context.question ? "Write your answer. Only you can see it." : undefined} />
    </>
  );
}
