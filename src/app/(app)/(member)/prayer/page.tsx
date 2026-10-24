import { ChevronRight, HandHelping, HeartHandshake, PenSquare, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import { CommunityText } from "@/components/community/community-text";
import { LiveRefresh } from "@/components/community/live-refresh";
import { Icon } from "@/components/icons/icon";
import { PrayerHeader } from "@/components/prayer/prayer-header";
import { PrayerRow, prayerListClass } from "@/components/prayer/prayer-row";
import { PrayerTabs } from "@/components/prayer/prayer-tabs";
import { SearchPanel } from "@/components/prayer/search-panel";
import { ViewMenu } from "@/components/prayer/view-menu";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, rowListClass } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { AUDIENCE_FILTERS, AUDIENCE_LABEL, decodeCursor, encodeCursor, pick, STATUS_FILTERS, STATUS_LABEL, VIEWS, type View } from "@/lib/prayer/format";
import type { PrayerGuidance, PrayerPage } from "@/lib/prayer/types";

export const metadata: Metadata = { title: "Prayer" };

const VIEW_LABEL: Record<View, string> = { feed: "All requests", mine: "My requests", following: "Following", answered: "Answered" };

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

const AUDIENCE_OPTION = (a: (typeof AUDIENCE_FILTERS)[number]) => (a === "any" ? "Everyone I can see" : AUDIENCE_LABEL[a]);

const selectClass = "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-base";

export default async function PrayerHomePage({ searchParams }: PageProps<"/prayer">) {
  await requireApprovedMember("/prayer");
  const sp = await searchParams;
  const view = pick(sp.view, VIEWS, "feed");
  const defaultStatus = view === "mine" ? "all" : "active";
  const status = pick(sp.status, STATUS_FILTERS, defaultStatus);
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
  const qs = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { view, status, audience, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "audience" && v === "any")) p.set(k, v);
    return `/prayer?${p.toString()}`;
  };
  const statusChoices = view === "mine" ? STATUS_FILTERS : STATUS_FILTERS.filter((s) => s !== "archived");
  const audienceChoices = view === "mine" ? AUDIENCE_FILTERS : AUDIENCE_FILTERS.filter((a) => a !== "private");
  // The Answered view has no Status or Audience filters (as before).
  const filterable = view !== "answered";
  const applied = filterable ? [status !== defaultStatus ? `Status: ${STATUS_OPTION[status]}` : null, audience !== "any" ? `Audience: ${AUDIENCE_OPTION(audience)}` : null].filter((x) => x !== null) : [];
  const resetHref = view === "feed" ? "/prayer" : `/prayer?view=${view}`;

  return (
    // Wide layout: the feed and the Practical care panel share the full width.
    <div className="layout-wide">
      <LiveRefresh />
      <PrayerHeader
        description="Pray for one another."
        action={
          guidance?.posting_restricted ? null : (
            <ButtonLink href="/prayer/new" icon={<PenSquare className="size-4" aria-hidden="true" />}>
              Share a request
            </ButtonLink>
          )
        }
        shortcut={
          <a
            href="#practical-care"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-meta font-semibold text-primary hover:bg-primary-soft focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <HeartHandshake className="size-4" aria-hidden="true" />
            Care &amp; help
            <ChevronRight className="size-4" aria-hidden="true" />
          </a>
        }
      />
      {sp.deleted ? <Alert tone="success" title="Your request was deleted." className="mb-4" /> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <PrayerTabs active="requests" />

          <SearchPanel
            view={view}
            tools={<ViewMenu active={view} />}
            filters={
              filterable
                ? {
                    count: applied.length,
                    panel: (
                      <form method="get" action="/prayer" aria-label="Filter requests" className="rounded-card border border-border bg-surface p-4 shadow-(--elev-card)">
                        <input type="hidden" name="view" value={view} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1 text-meta font-semibold">
                            <span className="block">Status</span>
                            <select name="status" defaultValue={status} className={selectClass}>
                              {statusChoices.map((s) => (
                                <option key={s} value={s}>
                                  {STATUS_OPTION[s]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1 text-meta font-semibold">
                            <span className="block">Audience</span>
                            <select name="audience" defaultValue={audience} className={selectClass}>
                              {audienceChoices.map((a) => (
                                <option key={a} value={a}>
                                  {AUDIENCE_OPTION(a)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button type="submit" className="min-h-11 rounded-full border border-border-strong bg-surface px-4 text-meta font-semibold hover:bg-surface-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary">
                            Apply
                          </button>
                          <ButtonLink href={resetHref} variant="ghost" size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />}>
                            Reset
                          </ButtonLink>
                        </div>
                      </form>
                    ),
                    summary: applied.length ? (
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-text-secondary">
                        <span className="sr-only">Filters applied:</span>
                        {applied.map((a) => (
                          <span key={a} className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-text">
                            {a}
                          </span>
                        ))}
                        <a href={resetHref} className="inline-flex min-h-8 items-center rounded-control px-1 font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-3 focus-visible:outline-primary">
                          Reset filters
                        </a>
                      </p>
                    ) : null,
                  }
                : undefined
            }
          >
            {!page ? (
              <Alert tone="error" title="Prayer requests couldn't be loaded right now.">
                Please try again in a moment.
              </Alert>
            ) : page.items.length ? (
              <>
                <ul className={prayerListClass} aria-label={VIEW_LABEL[view]}>
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

        <aside className="min-w-0 space-y-5 lg:border-l lg:border-border lg:pl-6" aria-label="Prayer and care">
          <section id="practical-care" aria-labelledby="care-heading" className="scroll-mt-24 space-y-2">
            <h2 id="care-heading" className="font-display text-[1.25rem] font-semibold text-text">
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
              <h2 id="team-heading" className="font-display text-[1.25rem] font-semibold text-text">
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
            <details className="group border-t border-border pt-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control font-semibold focus-visible:outline-3 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 text-text-secondary transition-transform group-open:rotate-90" aria-hidden="true" />
                Before you share
              </summary>
              <div className="mt-2 text-meta">
                <CommunityText source={guidance.guidance} />
              </div>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
