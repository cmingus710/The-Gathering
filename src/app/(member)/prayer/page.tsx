import { ChevronRight, HandHelping, PenSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CommunityText } from "@/components/community/community-text";
import { LiveRefresh } from "@/components/community/live-refresh";
import { Icon } from "@/components/icons/icon";
import { PrayerRow } from "@/components/prayer/prayer-row";
import { SearchPanel } from "@/components/prayer/search-panel";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, rowListClass } from "@/components/ui/card";
import { SectionHero } from "@/components/ui/section-hero";
import { SegmentedTrack, segmentClass } from "@/components/ui/segmented";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { menuArtSource } from "@/lib/home/launcher";
import { AUDIENCE_FILTERS, AUDIENCE_LABEL, decodeCursor, encodeCursor, pick, STATUS_FILTERS, STATUS_LABEL, VIEWS, type View } from "@/lib/prayer/format";
import type { PrayerGuidance, PrayerPage } from "@/lib/prayer/types";

export const metadata: Metadata = { title: "Prayer" };

const VIEW_LABEL: Record<View, string> = { feed: "Requests", mine: "My requests", following: "Following", answered: "Answered" };

const EMPTY: Record<View, { title: string; body: string }> = {
  feed: { title: "No prayer requests yet", body: "When members share requests with you, they'll appear here." },
  mine: { title: "You haven't shared a request", body: "Share a request or save a private draft whenever you're ready." },
  following: { title: "You're not following any requests", body: "Follow a request to hear about updates and new encouragement." },
  answered: { title: "No answered prayers yet", body: "Requests marked answered will be gathered here to encourage us all." },
};

const STATUS_OPTION: Record<(typeof STATUS_FILTERS)[number], string> = {
  active: "Open and answered",
  open: STATUS_LABEL.open,
  answered: STATUS_LABEL.answered,
  closed: STATUS_LABEL.closed,
  archived: STATUS_LABEL.archived,
  all: "All",
};

export default async function PrayerHomePage({ searchParams }: PageProps<"/prayer">) {
  await requireApprovedMember("/prayer");
  const sp = await searchParams;
  const view = pick(sp.view, VIEWS, "feed");
  const status = pick(sp.status, STATUS_FILTERS, view === "mine" ? "all" : "active");
  const audience = pick(sp.audience, AUDIENCE_FILTERS, "any");
  const cursor = decodeCursor(sp.after);
  const [page, guidance] = await Promise.all([
    tryCommunityRpc<PrayerPage>("prayer_requests", {
      p_view: view,
      p_status: status,
      p_audience: audience,
      p_query: null,
      p_before: cursor?.before ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_limit: 20,
    }),
    tryCommunityRpc<PrayerGuidance>("prayer_guidance"),
  ]);
  const art = menuArtSource("prayer");
  const qs = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { view, status, audience, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "audience" && v === "any")) p.set(k, v);
    return `/prayer?${p.toString()}`;
  };
  const statusChoices = view === "mine" ? STATUS_FILTERS : STATUS_FILTERS.filter((s) => s !== "archived");
  const audienceChoices = view === "mine" ? AUDIENCE_FILTERS : AUDIENCE_FILTERS.filter((a) => a !== "private");

  return (
    <>
      <LiveRefresh />
      <SectionHero art="prayer" glyph="prayer"
        eyebrow={
          art ? (
            // Decorative: the dimensional Prayer artwork supplied for the menu.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={art.src} srcSet={art.srcSet} sizes="64px" alt="" width={64} height={64} className="mb-2 size-16" />
          ) : undefined
        }
        title="Prayer"
        description="Share what's on your heart, choose who sees it, and pray for one another."
        actions={
          <>
            {guidance?.posting_restricted ? null : (
              <ButtonLink href="/prayer/new" icon={<PenSquare className="size-4" aria-hidden="true" />}>
                Share a request
              </ButtonLink>
            )}
            <ButtonLink href="/prayer/care/new" variant="secondary" icon={<HandHelping className="size-4" aria-hidden="true" />}>
              Request help
            </ButtonLink>
          </>
        }
      />
      {sp.deleted ? <Alert tone="success" title="Your request was deleted." className="mb-6" /> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
          <SegmentedTrack label="Prayer views" className="max-w-full overflow-x-auto">
            {VIEWS.map((v) => (
              <Link key={v} href={`/prayer?view=${v}`} className={segmentClass(v === view)} aria-current={v === view ? "page" : undefined}>
                {VIEW_LABEL[v]}
              </Link>
            ))}
          </SegmentedTrack>

          {view !== "answered" ? (
            <form method="get" action="/prayer" className="flex flex-wrap items-end gap-3" aria-label="Filter requests">
              <input type="hidden" name="view" value={view} />
              <label className="space-y-1 text-meta font-semibold">
                <span className="block">Status</span>
                <select name="status" defaultValue={status} className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-base">
                  {statusChoices.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_OPTION[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-meta font-semibold">
                <span className="block">Audience</span>
                <select name="audience" defaultValue={audience} className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-base">
                  {audienceChoices.map((a) => (
                    <option key={a} value={a}>
                      {a === "any" ? "Everyone I can see" : AUDIENCE_LABEL[a]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="min-h-11 rounded-full border border-border-strong bg-surface px-4 text-meta font-semibold hover:bg-surface-muted">
                Apply
              </button>
            </form>
          ) : null}

          <SearchPanel view={view}>
            {!page ? (
              <Alert tone="error" title="Prayer requests couldn't be loaded right now.">
                Please try again in a moment.
              </Alert>
            ) : page.items.length ? (
              <>
                <ul className={rowListClass} aria-label={VIEW_LABEL[view]}>
                  {page.items.map((c) => (
                    <li key={c.id}>
                      <PrayerRow card={c} />
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {cursor ? (
                    <ButtonLink href={qs({ after: null })} variant="ghost" size="sm">
                      Back to newest
                    </ButtonLink>
                  ) : null}
                  {page.has_more ? (
                    <ButtonLink href={qs({ after: encodeCursor(page.items[page.items.length - 1]) })} variant="secondary" size="sm">
                      Show older requests
                    </ButtonLink>
                  ) : null}
                </div>
              </>
            ) : (
              <EmptyState
                glyph="prayer"
                title={cursor ? "No older requests" : EMPTY[view].title}
                action={
                  view === "feed" || view === "mine" ? (
                    <ButtonLink href="/prayer/new" variant="secondary" size="sm">
                      Share a request
                    </ButtonLink>
                  ) : null
                }
              >
                {EMPTY[view].body}
              </EmptyState>
            )}
          </SearchPanel>
        </div>

        <aside className="space-y-6" aria-label="Prayer and care">
          <section aria-labelledby="care-heading" className="space-y-2">
            <h2 id="care-heading" className="text-meta font-semibold uppercase tracking-wide text-text-secondary">
              Practical care
            </h2>
            <ul className={rowListClass}>
              <li>
                <ListRow plain href="/prayer/care/new" icon={<HandHelping className="size-5" aria-hidden="true" />} label="Request help" description="Meals, rides, visits" trailing={<ChevronRight className="size-4" aria-hidden="true" />} />
              </li>
              <li>
                <ListRow plain href="/prayer/care" icon={<Icon name="profile" className="size-5" />} label="My care requests" trailing={<ChevronRight className="size-4" aria-hidden="true" />} />
              </li>
              <li>
                <ListRow plain href="/prayer/serve" icon={<Icon name="groups" className="size-5" />} label="Ways to help" description="Volunteer for care needs" trailing={<ChevronRight className="size-4" aria-hidden="true" />} />
              </li>
            </ul>
          </section>
          {guidance && (guidance.is_team || guidance.can_coordinate || guidance.can_moderate) ? (
            <section aria-labelledby="team-heading" className="space-y-2">
              <h2 id="team-heading" className="text-meta font-semibold uppercase tracking-wide text-text-secondary">
                For the team
              </h2>
              <ul className={rowListClass}>
                {guidance.is_team || guidance.can_coordinate ? (
                  <li>
                    <ListRow plain href="/prayer/team" icon={<Icon name="admin" className="size-5" />} label="Prayer & care workspace" trailing={<ChevronRight className="size-4" aria-hidden="true" />} />
                  </li>
                ) : null}
                {guidance.can_moderate ? (
                  <li>
                    <ListRow plain href="/admin/prayer" icon={<Icon name="moderation" className="size-5" />} label="Prayer reports" trailing={<ChevronRight className="size-4" aria-hidden="true" />} />
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
          {guidance ? (
            <details className="rounded-card border border-border bg-surface p-5">
              <summary className="cursor-pointer font-semibold">Before you share</summary>
              <div className="mt-3 text-meta">
                <CommunityText source={guidance.guidance} />
              </div>
            </details>
          ) : null}
        </aside>
      </div>
    </>
  );
}
