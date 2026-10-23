import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReasonList } from "@/components/media/reason-list";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid, KIND_LABEL } from "@/lib/media/format";
import type { ItemAdmin } from "@/lib/media/types";
import { itemReasons } from "@/lib/media/visibility";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime, timeZoneLabel, utcToZonedLocal } from "@/lib/time";
import { deleteDraftAction } from "../actions";
import { ContentForm } from "../content-form";
import { loadEditorData } from "../editor-data";
import { PublishPanel } from "../publish-panel";
import { BookDetailsForm, type BookDetailsAdmin } from "./book-details-form";

export const metadata: Metadata = { title: "Edit content" };

const SAVED: Record<string, string> = {
  created: "Draft saved. Preview it, then publish when it's ready.",
  saved: "Changes saved.",
  publish: "Published (or scheduled).",
  unpublish: "Unpublished. It's a draft again.",
  archive: "Archived. It's hidden everywhere.",
  restore: "Restored as a draft.",
  expiry: "Expiry saved.",
  video_created: "Draft video page created from the library video (nothing was copied). Add a description, thumbnail, topics, and audience, preview it, then publish it.",
  video_existing: "This library video already has a video page, so it opened instead of creating a second one.",
};

export default async function EditContentPage({ params, searchParams }: PageProps<"/admin/content/[id]">) {
  const viewer = await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const supabase = await requireClient();
  const [{ settings }, itemRes, data] = await Promise.all([getChurchSettings(), supabase.rpc("media_admin_item", { p_id: id }), loadEditorData(supabase)]);
  if (itemRes.error || !itemRes.data) notFound();
  const item = itemRes.data as ItemAdmin;
  const bookDetails =
    item.kind === "book" ? ((await supabase.rpc("media_admin_book_details", { p_item: id })).data as BookDetailsAdmin | null) : null;
  const tz = settings.timezone;
  const now = new Date();
  const inAnHour = new Date(now.getTime() + 3600_000);
  const canPublish = viewer.capabilities.has(CAPABILITIES.contentPublish);
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const error = typeof sp.error === "string" ? (sp.error === "unavailable" ? "The content service is unavailable." : sp.error.slice(0, 300)) : undefined;
  const publishedLabel =
    item.publish_at && item.state !== "draft"
      ? `${item.state === "scheduled" ? "Goes live" : "Published"} ${formatDateTime(item.publish_at, tz)}${item.expires_at ? ` · hides ${formatDateTime(item.expires_at, tz)}` : ""}`
      : null;

  return (
    <div className="layout-wide">
      <PageHeader
        eyebrow={
          <Link href="/admin/content" className="hover:underline">
            Teaching content · {KIND_LABEL[item.kind]}
          </Link>
        }
        title={item.title}
        description={`Last saved ${formatDateTime(item.updated_at, tz)}${item.updated_by_name ? ` by ${item.updated_by_name}` : ""}.`}
      />
      {saved ? <Alert tone="success" title={saved} className="mb-6" /> : null}
      {error ? <Alert tone="error" title={error} className="mb-6" /> : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="min-w-0">
          {data ? (
            <ContentForm kind={item.kind} item={item} data={data} timeZoneLabel={timeZoneLabel(tz)} />
          ) : (
            <Alert tone="error" title="The editor couldn't be loaded." />
          )}
          {item.kind === "book" ? (
            <Card className="mt-6">
              <SectionHeading description="Kindle link, reading dates, and a related lesson.">Reading details</SectionHeading>
              {bookDetails ? (
                <BookDetailsForm id={item.id} details={bookDetails} />
              ) : (
                <Alert tone="error" title="Reading details couldn't be loaded. Apply the Phase 13 migration if this is a new database." />
              )}
            </Card>
          ) : null}
        </div>
        <aside className="space-y-6 xl:sticky xl:top-6">
          {item.kind === "lesson" ? (
            <Card>
              <SectionHeading>Lesson builder</SectionHeading>
              <p className="mb-3 text-meta text-text-secondary">
                Build the workbook members open: scripture, teaching, questions, and media in order, with teacher-only notes members never see.
              </p>
              <ButtonLink href={`/admin/content/${item.id}/builder`} size="sm" variant="secondary">
                Open the lesson builder
              </ButtonLink>
            </Card>
          ) : null}
          <Card>
            <SectionHeading>Who can see it now</SectionHeading>
            <ReasonList reasons={itemReasons(item, (iso) => formatDateTime(iso, tz))} />
          </Card>
          <Card>
            <SectionHeading>Publishing</SectionHeading>
            <PublishPanel
              item={item}
              canPublish={canPublish}
              timeZoneLabel={timeZoneLabel(tz)}
              localPublish={utcToZonedLocal(item.publish_at ?? inAnHour, tz)}
              localExpiry={utcToZonedLocal(item.expires_at, tz)}
              publishedLabel={publishedLabel}
            />
          </Card>
          {item.status === "draft" && !item.first_published_at ? (
            <Card>
              <SectionHeading>Delete draft</SectionHeading>
              <ConfirmDialog trigger="Delete draft" title="Delete this draft?" confirmLabel="Delete" formAction={deleteDraftAction} hidden={{ id: item.id }}>
                The draft is removed. Files in the media library are kept.
              </ConfirmDialog>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
