import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/card";
import { ActivityEditorForm } from "@/components/youth/activity-editor";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { getChurchSettings } from "@/lib/settings/queries";
import { timeZoneLabel } from "@/lib/time";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "New activity" };

export default async function NewActivityPage() {
  await requireCapability(CAPABILITIES.youthActivities, "/admin/youth/activities/new");
  const [{ settings }, { data: groups }] = await Promise.all([
    getChurchSettings(),
    // Group names for assignment come from the same capability check.
    youthRead<Array<{ id: string; name: string }>>("youth_admin_activity_groups"),
  ]);
  return (
    <>
      <p className="-mt-1 mb-3">
        <Link href="/admin/youth/activities" className="inline-flex min-h-11 items-center text-meta font-semibold text-text-secondary hover:text-text hover:underline">
          ‹ Learn &amp; Play activities
        </Link>
      </p>
      <PageHeader title="New activity" description="Starts as a private draft. After saving, you can upload artwork, preview it, and publish." />
      <ActivityEditorForm
        activityId={null}
        art={[]}
        groups={groups ?? []}
        groupIds={[]}
        timeZoneLabel={`Church time (${timeZoneLabel(settings.timezone)})`}
        defaults={{
          title: "",
          summary: "",
          description: "",
          kind: "story",
          difficulty: "beginner",
          age_min: null,
          age_max: null,
          bible_story: "",
          scripture_refs: [],
          lesson_title: "",
          lesson_week: null,
          cover_asset_id: null,
          cover_alt: "",
          cover_decorative: false,
          content_source: "original",
          content_credit: "",
          change_note: "",
          available_from: "",
          available_until: "",
        }}
      />
    </>
  );
}
