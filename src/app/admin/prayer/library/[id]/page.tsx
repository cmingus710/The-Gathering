import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunityText } from "@/components/community/community-text";
import { LibraryModeration } from "@/components/prayer/library-controls";
import { PrayerResolveForm } from "@/components/prayer/resolve-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { exactTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { MODERATION_DONE, reasonLabel, type LibraryReportDetail } from "@/lib/prayer/library";
import { getChurchSettings } from "@/lib/settings/queries";
import { libraryResolveAction } from "../actions";

export const metadata: Metadata = { title: "Prayer Library report" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function LibraryReportPage({ params, searchParams }: PageProps<"/admin/prayer/library/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  await requireCapability(CAPABILITIES.prayerModerate, `/admin/prayer/library/${id}`);
  if (!UUID.test(id)) notFound();
  const [r, { settings }] = await Promise.all([tryCommunityRpc<LibraryReportDetail>("prayer_library_mod_report", { p_id: id }), getChurchSettings()]);
  if (!r) notFound();
  const tz = settings.timezone;
  const closed = r.status === "actioned" || r.status === "dismissed";
  const current = r.current;
  const done = typeof sp.done === "string" ? MODERATION_DONE[sp.done] : undefined;
  return (
    <>
      <Link href="/admin/prayer/library" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer Library moderation
      </Link>
      <PageHeader title={reasonLabel(r.reason)} description={`Reported by ${r.reporter} · ${exactTime(r.created_at, tz)}. Opening this report was recorded.`} />
      <div className="max-w-3xl space-y-6">
        {done ? <Alert tone="success" title={done} /> : null}
        <p className="flex flex-wrap gap-2">
          <Badge tone="info">Prayer Library</Badge>
          <Badge tone={closed ? "success" : "warning"}>{r.status}</Badge>
        </p>
        {r.details ? (
          <Card>
            <h2 className="mb-1 font-semibold">Reporter&apos;s note</h2>
            <p className="whitespace-pre-wrap">{r.details}</p>
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-1 font-semibold">Reported prayer (as it was when reported)</h2>
          {r.evidence ? (
            <>
              <p className="mb-2 text-meta text-text-secondary">
                Shared by {r.evidence.contributor}
                {r.evidence.origin === "shared" ? ` · from ${r.evidence.source_name || "another source"}` : " · their own prayer"}
                {r.evidence.source_url ? ` · ${r.evidence.source_url}` : ""}
              </p>
              <p className="font-semibold">{r.evidence.title}</p>
              <CommunityText source={r.evidence.body} />
            </>
          ) : (
            <p className="text-text-secondary">No copy was kept.</p>
          )}
        </Card>
        {current && r.prayer_id ? (
          <Card className="space-y-3">
            <h2 className="font-semibold">Actions</h2>
            <p className="text-meta text-text-secondary">
              Now: {current.hidden ? "hidden" : current.status === "archived" ? (current.mod_archived ? "archived by a moderator" : "archived by its contributor") : current.status === "draft" ? "moved back to drafts by its contributor" : "visible in the library"}
            </p>
            <LibraryModeration id={r.prayer_id} hidden={current.hidden} modArchived={current.mod_archived} status={current.status} reportId={r.id} />
            {current.status === "published" && !current.hidden ? (
              <Link href={`/prayer/library/${r.prayer_id}`} className="block text-meta font-semibold text-primary underline">
                Open the prayer in the library
              </Link>
            ) : null}
          </Card>
        ) : (
          <Alert tone="info" title="The prayer has since been deleted with its contributor's account." />
        )}
        <Card>
          <h2 className="mb-3 font-semibold">{closed ? "Resolution" : "Close the report"}</h2>
          {closed && r.resolution ? <p className="mb-3 whitespace-pre-wrap">{r.resolution}</p> : null}
          <PrayerResolveForm reportId={r.id} closed={closed} resolve={libraryResolveAction} />
        </Card>
        {r.log.length ? (
          <Card>
            <h2 className="mb-2 font-semibold">History</h2>
            <ul className="space-y-1 text-meta">
              {r.log.map((l, i) => (
                <li key={i}>
                  {exactTime(l.at, tz)} · {l.actor} · {l.action}
                  {l.reason ? ` · ${l.reason}` : ""}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
