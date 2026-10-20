import { RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StateBadge } from "@/components/media/badges";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import type { ItemState } from "@/lib/media/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { getSiteUrl } from "@/lib/site-url";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { refreshShowAction, showStatusAction } from "../actions";
import { ShowForm, type ShowFormValues } from "../show-form";

export const metadata: Metadata = { title: "Podcast show" };

const SAVED: Record<string, string> = {
  created: "Show created.",
  saved: "Show saved.",
  imported: "Show added and its episodes imported.",
  import_failed: "Show added, but the feed couldn't be imported yet. See the feed status below.",
  publish: "Published.",
  unpublish: "Unpublished.",
  archive: "Archived. Its feed is no longer refreshed.",
  restore: "Restored as a draft.",
};

type ShowDetail = ShowFormValues & {
  id: string;
  status: "draft" | "published" | "archived";
  group_name: string | null;
  last_fetched_at: string | null;
  last_success_at: string | null;
  fetch_error: string | null;
  consecutive_failures: number;
  refresh_due_at: string | null;
  episodes: Array<{ id: string; title: string; state?: ItemState; publish_at?: string | null; published_at?: string | null; missing_since?: string | null; has_audio?: boolean }>;
};

export default async function ShowAdminPage({ params, searchParams }: PageProps<"/admin/podcasts/[id]">) {
  await requireCapability(CAPABILITIES.podcastsManage, "/admin/podcasts");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const supabase = await requireClient();
  const [{ settings }, show, opts, images] = await Promise.all([
    getChurchSettings(),
    supabase.rpc("media_admin_show", { p_id: id }),
    supabase.rpc("media_admin_item_options"),
    supabase.rpc("media_admin_assets", { p_kind: "image", p_status: "ready", p_q: null, p_limit: 100, p_offset: 0 }),
  ]);
  if (show.error || !show.data) notFound();
  const s = show.data as ShowDetail;
  const tz = settings.timezone;
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const error = typeof sp.error === "string" ? (sp.error === "unavailable" ? "The podcast service is unavailable." : sp.error.slice(0, 300)) : undefined;
  const notice = typeof sp.notice === "string" ? sp.notice.slice(0, 300) : undefined;
  const statusForm = (action: string, label: string, variant: "primary" | "secondary" | "danger-outline" = "secondary") => (
    <form action={showStatusAction}>
      <input type="hidden" name="id" value={s.id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/podcasts" className="hover:underline">
            Podcasts
          </Link>
        }
        title={s.title}
        description={s.kind === "church" ? "Church show" : "External show"}
        actions={
          s.kind === "church" ? (
            <ButtonLink href="/admin/content/new?kind=episode" size="sm">
              New episode
            </ButtonLink>
          ) : null
        }
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={s.status === "published" ? "success" : "neutral"}>{s.status === "published" ? "Published" : s.status === "archived" ? "Archived" : "Draft"}</Badge>
        {s.public_feed ? <Badge tone="info">Public feed on</Badge> : null}
      </div>
      {saved ? <Alert tone="success" title={saved} className="mb-6" /> : null}
      {notice ? <Alert tone="success" title={notice} className="mb-6" /> : null}
      {error ? <Alert tone="error" title={error} className="mb-6" /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <ShowForm
          show={s}
          groups={((opts.data as { groups?: Array<{ id: string; name: string }> } | null)?.groups ?? [])}
          images={((images.data as { items?: Array<{ id: string; title: string; public_ok: boolean }> } | null)?.items ?? [])}
          feedUrl={`${getSiteUrl()}/podcast/feed.xml`}
        />
        <aside className="space-y-6">
          <Card>
            <SectionHeading>Status</SectionHeading>
            <div className="flex flex-wrap gap-2">
              {s.status !== "published" && s.status !== "archived" ? statusForm("publish", "Publish", "primary") : null}
              {s.status === "published" ? statusForm("unpublish", "Unpublish") : null}
              {s.status !== "archived" ? statusForm("archive", "Archive", "danger-outline") : statusForm("restore", "Restore")}
              {s.status === "archived" && s.kind === "external" ? (
                <ConfirmDialog trigger="Delete" title="Delete this show?" confirmLabel="Delete" formAction={showStatusAction} hidden={{ id: s.id, action: "delete" }}>
                  The show and its imported episode details are removed from the app. The publisher&apos;s podcast isn&apos;t affected.
                </ConfirmDialog>
              ) : null}
            </div>
          </Card>
          {s.kind === "external" && s.feed_url ? (
            <Card>
              <SectionHeading>Feed</SectionHeading>
              <dl className="space-y-1 text-meta">
                <div>
                  <dt className="inline text-text-secondary">Last checked: </dt>
                  <dd className="inline">{s.last_fetched_at ? formatDateTime(s.last_fetched_at, tz) : "Not yet"}</dd>
                </div>
                <div>
                  <dt className="inline text-text-secondary">Last success: </dt>
                  <dd className="inline">{s.last_success_at ? formatDateTime(s.last_success_at, tz) : "Not yet"}</dd>
                </div>
                <div>
                  <dt className="inline text-text-secondary">Next scheduled: </dt>
                  <dd className="inline">{s.status === "archived" ? "Paused (archived)" : s.refresh_due_at ? formatDateTime(s.refresh_due_at, tz) : "Soon"}</dd>
                </div>
              </dl>
              {s.fetch_error ? (
                <Alert tone="error" title="The last refresh had a problem" className="mt-3">
                  {s.fetch_error}
                  {s.consecutive_failures > 1 ? ` (${s.consecutive_failures} times in a row; retries slow down automatically)` : ""}
                </Alert>
              ) : null}
              <form action={refreshShowAction} className="mt-3">
                <input type="hidden" name="id" value={s.id} />
                <SubmitButton size="sm" variant="secondary" icon={<RefreshCw className="size-4" aria-hidden="true" />} pendingText="Refreshing…">
                  Refresh now
                </SubmitButton>
              </form>
            </Card>
          ) : null}
          <Card>
            <SectionHeading>{s.kind === "church" ? "Episodes" : "Recent episodes"}</SectionHeading>
            {s.episodes.length ? (
              <ul className={rowListClass}>
                {s.episodes.slice(0, 30).map((e) => (
                  <li key={e.id} className="px-3 py-2">
                    {s.kind === "church" ? (
                      <Link href={`/admin/content/${e.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                        <span className="min-w-0 flex-1 truncate font-semibold">{e.title}</span>
                        {e.state ? <StateBadge state={e.state} /> : null}
                      </Link>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{e.title}</span>
                        {e.missing_since ? <Badge tone="neutral">Removed by publisher</Badge> : null}
                        {!e.has_audio ? <Badge tone="neutral">No playable audio</Badge> : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-secondary">None yet.</p>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
