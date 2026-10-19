import { Megaphone, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { AnnouncementStatusBadge, PinnedBadge, VisibilityBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState, PageHeader } from "@/components/ui/card";
import type { Announcement } from "@/lib/announcements/queries";
import { effectiveStatus, type EffectiveStatus } from "@/lib/announcements/status";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Announcements" };

const FILTERS: Array<{ key: "all" | EffectiveStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "live", label: "Published" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Drafts" },
  { key: "expired", label: "Expired" },
  { key: "archived", label: "Archived" },
];

export default async function AdminAnnouncementsPage({ searchParams }: PageProps<"/admin/announcements">) {
  await requireCapability(CAPABILITIES.announcementsManage, "/admin/announcements");
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === params.filter)?.key ?? "all";
  const supabase = await requireClient();
  const { settings } = await getChurchSettings();
  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, status, visibility, pinned, publish_at, expires_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(300)
    .returns<Announcement[]>();

  const now = new Date();
  const rows = (data ?? []).map((a) => ({ ...a, effective: effectiveStatus(a, now) }));
  const shown = filter === "all" ? rows.filter((r) => r.effective !== "archived") : rows.filter((r) => r.effective === filter);

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Draft, schedule, publish, and archive announcements."
        actions={
          <ButtonLink href="/admin/announcements/new" icon={<Plus className="size-5" aria-hidden="true" />}>
            New announcement
          </ButtonLink>
        }
      />
      <nav aria-label="Filter announcements" className="-mx-1 mb-5 overflow-x-auto px-1">
        <ul className="flex gap-1.5">
          {FILTERS.map((f) => (
            <li key={f.key}>
              <Link
                href={f.key === "all" ? "/admin/announcements" : `/admin/announcements?filter=${f.key}`}
                aria-current={filter === f.key ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 font-semibold",
                  filter === f.key ? "border-text bg-text text-background" : "border-border-strong bg-surface hover:bg-surface-muted",
                )}
              >
                {f.label}
                <span className="ml-1.5 text-sm opacity-80">
                  ({f.key === "all" ? rows.filter((r) => r.effective !== "archived").length : rows.filter((r) => r.effective === f.key).length})
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {filter === "all" ? <p className="mb-4 text-[0.95rem] text-text-secondary">Archived announcements are listed under Archived.</p> : null}

      {error ? (
        <Alert tone="error" title="Announcements couldn't be loaded right now." />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="size-5" aria-hidden="true" />}
          title="Nothing here yet"
          action={<ButtonLink href="/admin/announcements/new" variant="secondary" size="sm">Write an announcement</ButtonLink>}
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((a) => (
            <li key={a.id}>
              <Link href={`/admin/announcements/${a.id}`} className="block rounded-card bg-surface p-4 hover:border-primary sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <AnnouncementStatusBadge status={a.effective} />
                  <VisibilityBadge visibility={a.visibility} />
                  {a.pinned ? <PinnedBadge /> : null}
                </div>
                <p className="mt-2 text-lg font-bold">{a.title}</p>
                <p className="text-[0.95rem] text-text-secondary">
                  {a.effective === "scheduled" && a.publish_at
                    ? `Publishes ${formatDateTime(a.publish_at, settings.timezone)}`
                    : a.publish_at && a.effective !== "draft"
                      ? `Published ${formatDateTime(a.publish_at, settings.timezone)}`
                      : `Last edited ${formatDateTime(a.updated_at, settings.timezone)}`}
                  {a.expires_at ? ` · ${a.effective === "expired" ? "Ended" : "Ends"} ${formatDateTime(a.expires_at, settings.timezone)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
