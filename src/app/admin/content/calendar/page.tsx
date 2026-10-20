import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StateBadge } from "@/components/media/badges";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isYm, monthBounds, todayIn } from "@/lib/media/format";
import type { ItemState } from "@/lib/media/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { timeZoneLabel } from "@/lib/time";

export const metadata: Metadata = { title: "Devotional calendar" };

type Entry = { id: string; title: string; date: string; state: ItemState; audience: string };

export default async function DevotionalCalendarPage({ searchParams }: PageProps<"/admin/content/calendar">) {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content/calendar");
  const sp = await searchParams;
  const { settings } = await getChurchSettings();
  const today = todayIn(settings.timezone);
  const ym = isYm(sp.month) ? sp.month : today.slice(0, 7);
  const m = monthBounds(ym);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_admin_calendar", { p_from: m.from, p_to: m.to });
  const entries = ((data ?? []) as Entry[]).reduce<Record<string, Entry[]>>((acc, e) => ((acc[e.date] ??= []).push(e), acc), {});
  const first = new Date(`${m.from}T12:00:00Z`);
  const lead = first.getUTCDay();
  const days = Number(m.to.slice(8, 10));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`)];
  const missing = Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`).filter((d) => d >= today && !entries[d]?.some((e) => e.state !== "archived"));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/content" className="hover:underline">
            Teaching content
          </Link>
        }
        title="Devotional calendar"
        description={`Each devotional belongs to one day in the church's time zone (${timeZoneLabel(settings.timezone)}). Days without one simply show none to members.`}
        actions={
          <ButtonLink href="/admin/content/new?kind=devotional" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
            New devotional
          </ButtonLink>
        }
      />
      {error ? <Alert tone="error" title="The calendar couldn't be loaded." className="mb-6" /> : null}
      <nav aria-label="Months" className="mb-4 flex items-center justify-between">
        <Link href={`?month=${m.prev}`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
          <ChevronLeft className="size-4" aria-hidden="true" /> Previous
        </Link>
        <h2 className="text-xl font-semibold">{m.label}</h2>
        <Link href={`?month=${m.next}`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
          Next <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </nav>
      {missing.length && ym >= today.slice(0, 7) ? (
        <p className="mb-3 text-meta text-text-secondary">{missing.length} upcoming day(s) this month have no devotional yet.</p>
      ) : null}
      <div className="hidden grid-cols-7 gap-1 text-center text-meta font-semibold text-text-secondary sm:grid" aria-hidden="true">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <ol className="grid gap-1 sm:grid-cols-7">
        {cells.map((d, i) =>
          d ? (
            <li
              key={d}
              className={cn(
                "min-h-24 rounded-tile border p-2",
                d === today ? "border-primary bg-primary-soft" : "border-border bg-surface",
                (entries[d]?.filter((e) => e.state !== "archived").length ?? 0) > 1 ? "ring-2 ring-accent/60" : "",
              )}
            >
              <p className="text-meta font-semibold">
                <time dateTime={d}>
                  <span className="sm:hidden">
                    {new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}
                  </span>
                  <span className="hidden sm:inline">{Number(d.slice(8))}</span>
                </time>
                {d === today ? <span className="ml-1 text-primary">· today</span> : null}
              </p>
              <ul className="mt-1 space-y-1">
                {(entries[d] ?? []).map((e) => (
                  <li key={e.id}>
                    <Link href={`/admin/content/${e.id}`} className="block rounded-[0.5rem] px-1 py-0.5 hover:bg-surface-muted">
                      <span className="line-clamp-2 text-[0.8125rem] font-semibold">{e.title}</span>
                      <StateBadge state={e.state} />
                    </Link>
                  </li>
                ))}
              </ul>
              {!entries[d]?.length && d >= today ? (
                <Link href={`/admin/content/new?kind=devotional&date=${d}`} className="mt-1 inline-block text-[0.8125rem] font-semibold text-primary hover:underline">
                  Add
                </Link>
              ) : null}
            </li>
          ) : (
            <li key={`empty-${i}`} aria-hidden="true" className="hidden sm:block" />
          ),
        )}
      </ol>
      <p className="mt-3 text-meta text-text-secondary">A highlighted day has more than one devotional; members see the first by display order and the others as “also today”.</p>
    </>
  );
}
