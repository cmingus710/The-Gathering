import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { isYmd, KIND_LABEL, todayIn } from "@/lib/media/format";
import type { ItemKind } from "@/lib/media/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { timeZoneLabel } from "@/lib/time";
import { ContentForm } from "../content-form";
import { loadEditorData } from "../editor-data";

export const metadata: Metadata = { title: "New content" };

const KINDS: ItemKind[] = ["devotional", "lesson", "episode", "book", "assignment", "playlist"];

export default async function NewContentPage({ searchParams }: PageProps<"/admin/content/new">) {
  await requireCapability(CAPABILITIES.contentEdit, "/admin/content/new");
  const sp = await searchParams;
  const kind = sp.kind as ItemKind;
  if (!KINDS.includes(kind)) notFound();
  const supabase = await requireClient();
  const [{ settings }, data] = await Promise.all([getChurchSettings(), loadEditorData(supabase)]);
  return (
    <div className="layout-wide">
      <PageHeader
        eyebrow={
          <Link href="/admin/content" className="hover:underline">
            Teaching content
          </Link>
        }
        title={`New ${KIND_LABEL[kind].toLowerCase()}`}
        description="Saved as a draft for approved members. Nobody sees it until a publisher publishes it."
      />
      {data ? (
        <ContentForm
          kind={kind}
          item={null}
          data={data}
          timeZoneLabel={timeZoneLabel(settings.timezone)}
          defaultDate={isYmd(sp.date) ? sp.date : todayIn(settings.timezone)}
        />
      ) : (
        <Alert tone="error" title="The editor couldn't be loaded. If Phase 7 hasn't been applied to the database yet, apply it first." />
      )}
    </div>
  );
}
