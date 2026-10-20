import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { TileIcon } from "@/components/icons/icon";
import { formatDay, itemHref, speakers } from "@/lib/media/format";
import type { ItemCard } from "@/lib/media/types";
import type { IconName } from "@/lib/icons";
import { HeadingLink, HomeSectionHeading } from "./sections";

export type HomeTeaching = {
  devotional: ItemCard | null;
  lesson: ItemCard | null;
  show: { id: string; title: string; kind: "church" | "external"; author: string | null } | null;
  assignment: ItemCard | null;
};

type Row = { key: string; glyph: IconName; eyebrow: string; title: string; detail: string | null; href: string };

/**
 * Compact teaching rows for the home page: only what has actually been
 * published (and the member can see). Nothing is shown when there is
 * nothing to show.
 */
export function TeachingSection({ data }: { data: HomeTeaching }) {
  const rows: Row[] = [];
  if (data.devotional) rows.push({ key: "d", glyph: "devotionals", eyebrow: "Today's devotional", title: data.devotional.title, detail: data.devotional.scripture_refs[0] ?? null, href: itemHref(data.devotional) });
  if (data.lesson)
    rows.push({
      key: "l",
      glyph: "lessons",
      eyebrow: "Latest lesson",
      title: data.lesson.title,
      detail: [data.lesson.delivered_on ? formatDay(data.lesson.delivered_on, "short") : null, speakers(data.lesson) || null].filter(Boolean).join(" · ") || null,
      href: itemHref(data.lesson),
    });
  if (data.show) rows.push({ key: "p", glyph: "podcasts", eyebrow: "Featured podcast", title: data.show.title, detail: data.show.kind === "church" ? "From our church" : data.show.author, href: `/podcasts/shows/${data.show.id}` });
  if (data.assignment)
    rows.push({ key: "a", glyph: "reading", eyebrow: "This week's reading", title: data.assignment.title, detail: data.assignment.book?.title ?? null, href: itemHref(data.assignment) });
  if (!rows.length) return null;
  return (
    <section aria-labelledby="home-teaching">
      <HomeSectionHeading id="home-teaching" action={<HeadingLink href="/media" label="All teaching and media" />}>
        Teaching &amp; media
      </HomeSectionHeading>
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key}>
            <Link href={r.href} className="interactive flex min-h-16 items-center gap-3 rounded-card border border-border bg-surface p-3 hover:bg-surface-muted/60">
              <TileIcon name={r.glyph} className="size-11 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] font-semibold text-text-secondary">{r.eyebrow}</span>
                <span className="block truncate font-semibold text-text">{r.title}</span>
                {r.detail ? <span className="block truncate text-meta text-text-secondary">{r.detail}</span> : null}
              </span>
              <ChevronRight className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
