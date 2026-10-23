import { ArrowLeft, Flag, Tags } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LibraryModeration } from "@/components/prayer/library-controls";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { exactTime, relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { MODERATION_DONE, reasonLabel, type LibraryReportRow, type ModeratedItem } from "@/lib/prayer/library";
import { getChurchSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Prayer Library moderation" };


/** Prayer moderators: library reports, and prayers a moderator hid or archived. */
export default async function LibraryModerationPage({ searchParams }: PageProps<"/admin/prayer/library">) {
  const viewer = await requireCapability(CAPABILITIES.prayerModerate, "/admin/prayer/library");
  const sp = await searchParams;
  const status = sp.status === "closed" ? "closed" : "open";
  const [reports, items, { settings }] = await Promise.all([
    tryCommunityRpc<LibraryReportRow[]>("prayer_library_mod_reports", { p_status: status }),
    tryCommunityRpc<ModeratedItem[]>("prayer_library_mod_items"),
    getChurchSettings(),
  ]);
  const done = typeof sp.done === "string" ? MODERATION_DONE[sp.done] : undefined;
  return (
    <>
      <Link href="/admin/prayer" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer reports
      </Link>
      <PageHeader
        title="Prayer Library moderation"
        description="Reported library prayers, and prayers a moderator hid or archived. Every action needs a reason and is recorded. Contributions publish without approval."
        actions={
          viewer.capabilities.has(CAPABILITIES.settingsManage) ? (
            <ButtonLink href="/admin/prayer/library/categories" variant="secondary" size="sm" icon={<Tags className="size-4" aria-hidden="true" />}>
              Topics, purposes, and uses
            </ButtonLink>
          ) : null
        }
      />
      {done ? <Alert tone="success" title={done} className="mb-6" /> : null}
      <div className="space-y-10">
        <section aria-labelledby="lib-reports-heading">
          <SectionHeading id="lib-reports-heading">Reports</SectionHeading>
          <nav aria-label="Report status" className="mb-3 flex gap-2">
            <Link href="/admin/prayer/library" aria-current={status === "open" ? "page" : undefined} className="rounded-full px-4 py-2 font-semibold aria-[current=page]:bg-surface-muted">
              Open
            </Link>
            <Link href="/admin/prayer/library?status=closed" aria-current={status === "closed" ? "page" : undefined} className="rounded-full px-4 py-2 font-semibold aria-[current=page]:bg-surface-muted">
              Closed
            </Link>
          </nav>
          {!reports ? (
            <Alert tone="error" title="Reports couldn't be loaded." />
          ) : reports.length ? (
            <ul className="space-y-2">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/prayer/library/${r.id}`} className="block rounded-card border border-border bg-surface px-5 py-4 hover:bg-surface-muted">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{reasonLabel(r.reason)}</span>
                      {r.status === "reviewing" ? <Badge tone="warning">In review</Badge> : null}
                    </span>
                    <span className="block text-meta text-text-secondary">
                      {r.title ? `“${r.title}”` : "A prayer"} shared by {r.reported} · {relativeTime(r.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Flag className="size-6" aria-hidden="true" />} title={status === "open" ? "No open library reports" : "No closed library reports"} />
          )}
        </section>

        <section aria-labelledby="lib-moderated-heading">
          <SectionHeading id="lib-moderated-heading" description="Members can't find or open these. Restore one if it was hidden or archived by mistake.">
            Hidden and archived by moderators
          </SectionHeading>
          {!items ? (
            <Alert tone="error" title="These couldn't be loaded." />
          ) : items.length ? (
            <ul className="space-y-2">
              {items.map((i) => (
                <li key={i.id} className="space-y-2 rounded-card border border-border bg-surface px-5 py-4">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{i.title}</span>
                    <Badge tone={i.state === "hidden" ? "danger" : "neutral"}>{i.state === "hidden" ? "Hidden" : "Archived"}</Badge>
                  </p>
                  <p className="text-meta text-text-secondary">
                    Shared by {i.contributor} · <time dateTime={i.at} title={exactTime(i.at, settings.timezone)}>{relativeTime(i.at)}</time>
                    {i.last ? ` · ${i.last.actor}: ${i.last.reason ?? "no reason recorded"}` : ""}
                  </p>
                  {i.mine ? (
                    <p className="text-meta text-text-secondary">Your own contribution: another moderator needs to review it.</p>
                  ) : (
                    <LibraryModeration id={i.id} hidden={i.state === "hidden"} modArchived={i.state === "archived"} status={i.state === "archived" ? "archived" : "published"} />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary">Nothing is hidden or archived by a moderator.</p>
          )}
        </section>
      </div>
    </>
  );
}
