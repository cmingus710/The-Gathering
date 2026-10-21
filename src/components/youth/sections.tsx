import { CalendarDays, Megaphone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/card";
import { renderAnnouncementMarkdown } from "@/lib/announcements/markdown";
import { REGISTRATION_STATUS, formatWhen } from "@/lib/youth/format";
import type { Announcement, ChildEvent, Learning } from "@/lib/youth/types";
import { StateBadge } from "./state-badge";

export function AnnouncementList({ items, empty }: { items: Announcement[]; empty: string }) {
  if (items.length === 0) return <EmptyState icon={<Megaphone className="size-5" aria-hidden="true" />} title={empty} />;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="rounded-card border border-border bg-surface p-5 shadow-(--elev-card)">
          <div className="flex flex-wrap items-center gap-2 text-meta text-text-secondary">
            <span>{a.group ?? "All youth groups"}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={a.publish_at ?? undefined}>{formatWhen(a.publish_at)}</time>
            {a.author ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{a.author}</span>
              </>
            ) : null}
          </div>
          <h3 className="mt-1 text-[1.125rem] font-semibold">{a.title}</h3>
          {a.body ? <div className="prose-gathering mt-2 break-words" dangerouslySetInnerHTML={{ __html: renderAnnouncementMarkdown(a.body) }} /> : null}
          <p className="mt-2 text-meta text-text-secondary">
            For {[a.to_youth ? "youth" : null, a.to_guardians ? "parents and guardians" : null].filter(Boolean).join(" and ")}
            {a.group ? ` in ${a.group}` : ""}.
          </p>
        </li>
      ))}
    </ul>
  );
}

export function EventList({ items, empty, render, hrefFor }: { items: ChildEvent[]; empty: string; render?: (e: ChildEvent) => ReactNode; hrefFor?: (e: ChildEvent) => string }) {
  if (items.length === 0) return <EmptyState icon={<CalendarDays className="size-5" aria-hidden="true" />} title={empty} />;
  return (
    <ul className="space-y-3">
      {items.map((e) => (
        <li key={e.occurrence_id} className="space-y-2 rounded-card border border-border bg-surface p-5 shadow-(--elev-card)">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[1.0625rem] font-semibold">
                {hrefFor ? (
                  <Link href={hrefFor(e)} className="hover:underline">
                    {e.title}
                  </Link>
                ) : (
                  e.title
                )}
              </h3>
              <p className="text-meta text-text-secondary">
                {formatWhen(e.starts_at, e.timezone)}
                {e.location_name ? ` · ${e.location_name}` : ""}
                {e.group ? ` · ${e.group}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {e.status === "canceled" ? <Badge tone="danger">Canceled</Badge> : null}
              {e.registration && e.registration.status !== "canceled" ? (
                <StateBadge map={REGISTRATION_STATUS} value={e.registration.status} />
              ) : null}
              {e.places_left !== null && e.places_left !== undefined ? (
                <Badge tone="neutral">{e.places_left === 0 ? (e.waitlist_enabled ? "Full (waitlist open)" : "Full") : `${e.places_left} places left`}</Badge>
              ) : null}
            </div>
          </div>
          {render ? render(e) : null}
        </li>
      ))}
    </ul>
  );
}

const LEARNING_KIND: Record<Learning["kind"], string> = {
  memory_collection: "Memory verses",
  reading_plan: "Bible reading plan",
  resource: "Lesson or resource",
};

export function LearningList({ items, empty }: { items: Learning[]; empty: string }) {
  if (items.length === 0) return <EmptyState glyph="memory" title={empty} />;
  return (
    <ul className="space-y-2">
      {items.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-meta text-text-secondary">{LEARNING_KIND[l.kind]}</p>
            <p className="font-semibold">{l.href ? <Link href={l.href} className="hover:underline">{l.title}</Link> : l.title}</p>
            {l.note ? <p className="text-meta text-text-secondary">{l.note}</p> : null}
          </div>
          {l.ends_on ? <span className="text-meta text-text-secondary">Until {l.ends_on}</span> : null}
        </li>
      ))}
    </ul>
  );
}
