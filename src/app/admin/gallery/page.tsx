import { Flag, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AudienceBadge } from "@/components/media/badges";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/media/format";
import type { Album } from "@/lib/media/types";
import { requireClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Gallery" };

export default async function GalleryAdminPage({ searchParams }: PageProps<"/admin/gallery">) {
  await requireAnyCapability([CAPABILITIES.galleryModerate, CAPABILITIES.eventsManage], "/admin/gallery");
  const sp = await searchParams;
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_admin_albums");
  const d = (data ?? { albums: [], can_moderate: false, open_reports: 0 }) as {
    albums: Array<Album & { pending: number; hidden: number; mine: boolean }>;
    can_moderate: boolean;
    open_reports: number | null;
  };
  return (
    <>
      <PageHeader
        eyebrow="Teaching & media"
        title="Photo galleries"
        description={
          d.can_moderate
            ? "Albums for approved members or one group (never public). Member photos wait for your approval."
            : "Create albums for your events. Gallery moderators publish albums and review photos."
        }
        actions={
          <>
            <ButtonLink href="/admin/gallery/new" size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
              New album
            </ButtonLink>
            {d.can_moderate ? (
              <ButtonLink href="/admin/gallery/reports" variant="secondary" size="sm" icon={<Flag className="size-4" aria-hidden="true" />}>
                Reports{d.open_reports ? ` (${d.open_reports})` : ""}
              </ButtonLink>
            ) : null}
          </>
        }
      />
      {sp.saved === "deleted" ? <Alert tone="success" title="Album deleted." className="mb-6" /> : null}
      {error ? <Alert tone="error" title="Albums couldn't be loaded." className="mb-6" /> : null}
      {d.albums.length ? (
        <ul className={rowListClass}>
          {d.albums.map((a) => (
            <li key={a.id}>
              <Link href={`/admin/gallery/${a.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.title}</span>
                  <span className="block truncate text-meta text-text-secondary">
                    {[a.album_on ? formatDay(a.album_on, "short") : null, `${a.photo_count} published`, a.event?.title].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge tone={a.status === "published" ? "success" : "neutral"}>{a.status === "published" ? "Published" : a.status === "archived" ? "Archived" : "Draft"}</Badge>
                  <AudienceBadge audience={a.audience} groupName={a.group_name} />
                  {a.pending ? <Badge tone="warning">{a.pending} waiting</Badge> : null}
                  {a.uploads_open ? <Badge tone="info">Open for photos</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState glyph="gallery" title="No albums yet">
          Create an album, then publish it and open it for member photos.
        </EmptyState>
      )}
    </>
  );
}
