import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import type { Translation } from "@/lib/bible/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bible" };

/** Opens the member's preferred (or the church's default) translation. */
export default async function ReadPage() {
  await requireLearner("/bible/read");
  const supabase = await requireClient();
  const { data } = await supabase.rpc("bible_translations");
  const t = data as { default_id: string | null; preferred_id: string | null; items: Translation[] } | null;
  const chosen = t?.items.find((x) => x.id === t.preferred_id) ?? t?.items.find((x) => x.id === t.default_id) ?? t?.items[0];
  if (chosen) {
    const books = await supabase.rpc("bible_books", { p_translation: chosen.id });
    const list = (books.data as Array<{ code: string }> | null) ?? [];
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
