import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudienceBadge, StateBadge } from "@/components/media/badges";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import type { BuilderPayload } from "@/lib/media/workbook";
import { requireClient } from "@/lib/supabase/server";
import type { AssetChoice } from "../../editor-data";
import { LessonBuilder } from "./lesson-builder";

export const metadata: Metadata = { title: "Lesson builder" };

export default async function LessonBuilderPage({ params }: PageProps<"/admin/content/[id]/builder">) {
  await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await requireClient();
  const ready = (kind: string) => supabase.rpc("media_admin_assets", { p_kind: kind, p_status: "ready", p_q: null, p_limit: 100, p_offset: 0 });
  const [res, image, audio, video, external, document] = await Promise.all([
    supabase.rpc("media_admin_lesson_blocks", { p_item: id }),
    ready("image"),
    ready("audio"),
    ready("video"),
    ready("external_video"),
    ready("document"),
  ]);
  if (res.error?.code === "P0002") notFound();
  if (res.error || !res.data) return <Alert tone="error" title="The lesson builder couldn't be loaded." />;
  const data = res.data as BuilderPayload;
  const list = (r: { data: unknown }) => ((r.data as { items: AssetChoice[] } | null)?.items ?? []) as AssetChoice[];

  return (
    <div className="layout-wide">
      <PageHeader
        eyebrow={
          <Link href={`/admin/content/${id}`} className="hover:underline">
            Teaching content · Sunday lesson
          </Link>
        }
        title={`Lesson builder: ${data.lesson.title}`}
        description="Build the lesson members open as a workbook. Teacher-only blocks and notes are never shown to members."
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StateBadge state={data.lesson.state} />
        <AudienceBadge audience={data.lesson.audience} groupName={data.lesson.group_name} />
        <Link href={`/admin/content/${id}/builder/preview`} className="ml-2 font-semibold text-primary hover:underline">
          Preview the member workbook
        </Link>
        <Link href={`/admin/content/${id}`} className="ml-2 font-semibold text-primary hover:underline">
          Lesson details and publishing
        </Link>
      </div>
      <LessonBuilder
        payload={data}
        assets={{ image: list(image), media: [...list(audio), ...list(video), ...list(external), ...list(document)] }}
      />
    </div>
  );
}
