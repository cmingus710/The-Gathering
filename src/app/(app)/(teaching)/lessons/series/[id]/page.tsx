/* eslint-disable @next/next/no-img-element -- short-lived signed URLs */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FramedImage } from "@/components/media/framed-image";
import { ItemCard } from "@/components/media/item-card";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { coverPaths, isUuid } from "@/lib/media/format";
import { parseFraming, type Framing } from "@/lib/media/framing";
import { signPaths } from "@/lib/media/storage";
import type { ItemCard as Card } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Series" };

type Series = { id: string; title: string; description: string; cover: { path: string; alt: string; framing?: Framing | null } | null; items: Card[] };

export default async function SeriesPage({ params }: PageProps<"/lessons/series/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_series", { p_id: id });
  if (error || !data) notFound();
  const s = data as Series;
  const urls = await signPaths(supabase, [...(s.cover ? [s.cover.path] : []), ...coverPaths(s.items)]);
  const cover = s.cover ? urls.get(s.cover.path) : null;
  return (
    <>
      <BackLink route="/lessons/series/[id]" />
      {cover && s.cover?.framing ? (
        // Positioned for this series (the "Series page" preview in the editor).
        <FramedImage src={cover} alt={s.cover.alt ?? ""} framing={parseFraming(s.cover.framing)} className="mb-6 aspect-[5/2] w-full rounded-card" />
      ) : cover ? (
        <img src={cover} alt={s.cover?.alt ?? ""} className="mb-6 max-h-72 w-full rounded-card object-cover" />
      ) : null}
      <PageHeader eyebrow="Series" title={s.title} description={s.description || undefined} />
      <p className="mb-4 text-meta text-text-secondary">
        {s.items.length} part{s.items.length === 1 ? "" : "s"}
      </p>
      <ol className="space-y-3">
        {[...s.items].reverse().map((i) => (
          <li key={i.id}>
            <ItemCard item={i} urls={urls} showKind={i.kind !== "lesson"} />
          </li>
        ))}
      </ol>
    </>
  );
}
