import { BookMarked, CalendarDays, Library, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AudienceBadge, StateBadge } from "@/components/media/badges";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, rowListClass } from "@/components/ui/card";
import { SegmentedTrack, segmentClass } from "@/components/ui/segmented";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { formatDay, KIND_LABEL, KIND_PLURAL } from "@/lib/media/format";
import type { Audience, ItemKind, ItemState } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Teaching content" };

const KINDS: ItemKind[] = ["devotional", "lesson", "video", "episode", "book", "assignment", "playlist"];
const STATES: Array<[ItemState | "", string]> = [
  ["", "Active"],
  ["draft", "Drafts"],
  ["scheduled", "Scheduled"],
  ["live", "Published"],
  ["expired", "Expired"],
  ["archived", "Archived"],
];

type Row = {
  id: string;
  kind: ItemKind;
  title: string;
  state: ItemState;
  audience: Audience;
  group_name: string | null;
  featured: boolean;
  publish_at: string | null;
  devotional_on: string | null;
  delivered_on: string | null;
  starts_on: string | null;
  show: string | null;
};

export default async function ContentListPage({ searchParams }: PageProps<"/admin/content">) {
  const viewer = await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content");
  const sp = await searchParams;
  const kind = KINDS.includes(sp.kind as ItemKind) ? (sp.kind as ItemKind) : null;
  const state = STATES.some(([s]) => s === sp.state) ? (sp.state as ItemState | "") : "";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_admin_items", { p_kind: kind, p_state: state || null, p_q: q || null, p_limit: 100, p_offset: 0 });
  const rows = ((data as { items: Row[] } | null)?.items ?? []) as Row[];
  const total = (data as { total: number } | null)?.total ?? 0;
  const href = (k: ItemKind | null, s: string) => ({ pathname: "/admin/content", query: { ...(k ? { kind: k } : {}), ...(s ? { state: s } : {}), ...(q ? { q } : {}) } });
  const canPublish = viewer.capabilities.has(CAPABILITIES.contentPublish);

  return (
    <>
      <PageHeader
        eyebrow="Teaching & media"
        title="Teaching content"
        description={
          canPublish
            ? "Devotionals, Sunday lessons, church podcast episodes, books and reading assignments, and playlists. New content is a draft for approved members until you publish it."
            : "Write and preview drafts. A content publisher reviews and publishes them."
        }
        actions={
          <>
            <ButtonLink href="/admin/content/calendar" variant="secondary" size="sm" icon={<CalendarDays className="size-4" aria-hidden="true" />}>
              Devotional calendar
            </ButtonLink>
            <ButtonLink href="/admin/content/library" variant="secondary" size="sm" icon={<Library className="size-4" aria-hidden="true" />}>
              Series, people, topics
            </ButtonLink>
            <ButtonLink href="/admin/content/collections" variant="secondary" size="sm" icon={<BookMarked className="size-4" aria-hidden="true" />}>
              Devotional collections
            </ButtonLink>
          </>
        }
      />
      {sp.saved === "deleted" ? <Alert tone="success" title="Draft deleted." className="mb-6" /> : null}
      {error ? <Alert tone="error" title="Content couldn't be loaded. If Phase 7 hasn't been applied to the database yet, apply it first." className="mb-6" /> : null}

      <section aria-labelledby="new-content" className="mb-6">
        <h2 id="new-content" className="mb-2 text-meta font-semibold text-text-secondary">
          Create
        </h2>
        <ul className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <li key={k}>
              <ButtonLink href={`/admin/content/new?kind=${k}`} variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
                {KIND_LABEL[k]}
              </ButtonLink>
            </li>
          ))}
        </ul>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SegmentedTrack label="Kind" className="max-w-full overflow-x-auto">
          <Link href={href(null, state)} className={segmentClass(!kind)} aria-current={!kind ? "page" : undefined}>
            All
          </Link>
          {KINDS.map((k) => (
            <Link key={k} href={href(k, state)} className={segmentClass(kind === k)} aria-current={kind === k ? "page" : undefined}>
              {KIND_PLURAL[k].replace("Church podcast episodes", "Episodes").replace("Reading assignments", "Assignments")}
            </Link>
          ))}
        </SegmentedTrack>
      </div>
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        <div className="min-w-48 flex-1 space-y-1.5">
          <label htmlFor="content-q" className="block text-meta font-semibold">
            Search titles
          </label>
          <input id="content-q" name="q" defaultValue={q} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="content-state" className="block text-meta font-semibold">
            State
          </label>
          <select id="content-state" name="state" defaultValue={state} className="min-h-11 rounded-control border border-border-strong bg-surface px-3">
            {STATES.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="min-h-11 rounded-full border border-border-strong bg-surface px-4 font-semibold hover:bg-surface-muted">
          Filter
        </button>
      </form>

      {rows.length ? (
        <>
          <ul className={rowListClass}>
            {rows.map((r) => {
              const day = r.devotional_on ?? r.delivered_on ?? r.starts_on ?? r.publish_at?.slice(0, 10) ?? null;
              return (
                <li key={r.id}>
                  <Link href={`/admin/content/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.title}</span>
                      <span className="block truncate text-meta text-text-secondary">
                        {[KIND_LABEL[r.kind], r.show, day ? formatDay(day, "short") : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <StateBadge state={r.state} />
                      <AudienceBadge audience={r.audience} groupName={r.group_name} />
                      {r.featured ? <Badge tone="warning">Featured</Badge> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {total > rows.length ? <p className="mt-3 text-meta text-text-secondary">Showing the newest 100 of {total}. Search or filter to narrow the list.</p> : null}
        </>
      ) : (
        <EmptyState glyph="lessons" title="Nothing here yet">
          Create a devotional, lesson, episode, book, assignment, or playlist above.
        </EmptyState>
      )}
    </>
  );
}
