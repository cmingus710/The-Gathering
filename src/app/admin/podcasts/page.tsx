import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AudienceBadge } from "@/components/media/badges";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import type { Audience } from "@/lib/media/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Podcasts" };

type Row = {
  id: string;
  kind: "church" | "external";
  title: string;
  status: string;
  audience: Audience;
  group_name: string | null;
  featured: boolean;
  public_feed: boolean;
  episode_count: number;
  feed_url: string | null;
  provider: string | null;
  last_success_at: string | null;
  fetch_error: string | null;
  consecutive_failures: number;
};

export default async function PodcastsAdminPage({ searchParams }: PageProps<"/admin/podcasts">) {
  await requireCapability(CAPABILITIES.podcastsManage, "/admin/podcasts");
  const sp = await searchParams;
  const supabase = await requireClient();
  const [{ settings }, { data, error }] = await Promise.all([getChurchSettings(), supabase.rpc("media_admin_shows")]);
  const shows = (data ?? []) as Row[];
  return (
    <>
      <PageHeader
        eyebrow="Teaching & media"
        title="Podcasts"
        description="The church's own shows (episodes are created in Teaching content) and external shows imported from their public feeds."
        actions={
          <>
            <ButtonLink href="/admin/podcasts/new?kind=church" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
              Church show
            </ButtonLink>
            <ButtonLink href="/admin/podcasts/new?kind=external" variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
              External show
            </ButtonLink>
          </>
        }
      />
      {sp.saved === "deleted" ? <Alert tone="success" title="Show deleted with its imported episodes." className="mb-6" /> : null}
      {error ? <Alert tone="error" title="Shows couldn't be loaded." className="mb-6" /> : null}
      {shows.length ? (
        <ul className={rowListClass}>
          {shows.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/podcasts/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{s.title}</span>
                  <span className="block truncate text-meta text-text-secondary">
                    {s.kind === "church" ? "Church show" : s.feed_url ? "External feed" : `External (${s.provider === "apple" ? "Apple Podcasts" : "Spotify"} only)`} · {s.episode_count} episode
                    {s.episode_count === 1 ? "" : "s"}
                    {s.kind === "external" && s.last_success_at ? ` · refreshed ${formatDateTime(s.last_success_at, settings.timezone)}` : ""}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge tone={s.status === "published" ? "success" : "neutral"}>{s.status === "published" ? "Published" : s.status === "archived" ? "Archived" : "Draft"}</Badge>
                  <AudienceBadge audience={s.audience} groupName={s.group_name} />
                  {s.featured ? <Badge tone="warning">Featured</Badge> : null}
                  {s.public_feed ? <Badge tone="info">Public feed</Badge> : null}
                  {s.fetch_error ? <Badge tone="danger">Feed problem</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState glyph="podcasts" title="No shows yet">
          Create the church&apos;s own show, or add an external show from its public feed.
        </EmptyState>
      )}
    </>
  );
}
