import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ItemCard } from "@/components/media/item-card";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { coverPaths, isYm, monthBounds, todayIn } from "@/lib/media/format";
import { listItems } from "@/lib/media/pages";
import { signPaths } from "@/lib/media/storage";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Devotional archive" };

export default async function DevotionalArchivePage({ searchParams }: PageProps<"/devotionals/archive">) {
  const sp = await searchParams;
  const { settings } = await getChurchSettings();
  const today = todayIn(settings.timezone);
  const ym = isYm(sp.month) && sp.month <= today.slice(0, 7) ? sp.month : today.slice(0, 7);
  const m = monthBounds(ym);
  const supabase = await requireClient();
  const list = await listItems(supabase, "devotional", { from: m.from, to: m.to < today ? m.to : today }, 60);
  const urls = await signPaths(supabase, coverPaths(list.items));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/devotionals" className="hover:underline">
            Devotionals
          </Link>
        }
        title="Archive"
      />
      <nav aria-label="Months" className="mb-4 flex items-center justify-between">
        <Link href={`?month=${m.prev}`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
          <ChevronLeft className="size-4" aria-hidden="true" /> Earlier
        </Link>
        <h2 className="text-lg font-semibold">{m.label}</h2>
        {m.next <= today.slice(0, 7) ? (
          <Link href={`?month=${m.next}`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
            Later <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <span />
        )}
      </nav>
      {!list.ok ? <Alert tone="error" title="The archive couldn't be loaded." /> : null}
      {list.items.length ? (
        <ul className="space-y-3">
          {list.items.map((i) => (
            <li key={i.id}>
              <ItemCard item={i} urls={urls} />
            </li>
          ))}
        </ul>
      ) : list.ok ? (
        <EmptyState glyph="devotionals" title={`No devotionals in ${m.label}`} />
      ) : null}
    </>
  );
}
