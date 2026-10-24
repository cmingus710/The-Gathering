import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReadingView } from "@/components/devotionals/reading-view";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import { bodyBlocks, dateInYear } from "@/lib/devotionals/calendar";
import type { AdminReading, CollectionAdmin } from "@/lib/devotionals/types";
import { isUuid } from "@/lib/media/format";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { ReadingForm, RestoreForm } from "../../../forms";

export const metadata: Metadata = { title: "Devotional reading" };

const REPLACED: Record<string, string> = { edit: "replaced by a correction", restore: "replaced by restoring the imported text", import: "replaced by a newer import" };

/** One reading: a preview as members see it, the correction form, the imported text, and its history. */
export default async function AdminReadingPage({ params, searchParams }: PageProps<"/admin/content/collections/[id]/readings/[readingId]">) {
  const { id, readingId } = await params;
  if (!isUuid(id) || !isUuid(readingId)) notFound();
  const viewer = await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], `/admin/content/collections/${id}/readings/${readingId}`);
  const sp = await searchParams;
  const supabase = await requireClient();
  const [{ settings }, reading, collection] = await Promise.all([
    getChurchSettings(),
    supabase.rpc("media_admin_collection_reading", { p_id: readingId }),
    supabase.rpc("media_admin_collection", { p_id: id }),
  ]);
  if (reading.error?.code === "P0002" || collection.error?.code === "P0002") notFound();
  if (reading.error || !reading.data || !collection.data) return <Alert tone="error" title="This reading couldn't be loaded right now." />;
  const r = reading.data as AdminReading;
  const c = collection.data as CollectionAdmin;
  if (r.collection.id !== c.id) notFound();
  const tz = settings.timezone;
  const canPublish = viewer.capabilities.has(CAPABILITIES.contentPublish);
  const locked = c.status === "published" && !canPublish;
  const saved = sp.saved === "1" ? "Correction saved. It applies to this reading in every year." : sp.saved === "restored" ? "Text restored." : null;
  const year = new Date().getFullYear();
  const form = { id: r.id, collection_id: c.id, revision: r.revision, key_verse: r.key_verse, scripture_ref: r.scripture_ref, body: r.body, label: r.label };

  return (
    <div className="layout-wide">
      <PageHeader
        eyebrow={
          <Link href={`/admin/content/collections/${c.id}?month=${r.month}`} className="hover:underline">
            {c.title}
          </Link>
        }
        title={r.label}
        description={`Source key ${r.source_key} · revision ${r.revision}${r.edited && r.edited_at ? ` · corrected ${formatDateTime(r.edited_at, tz)}${r.edited_by ? ` by ${r.edited_by}` : ""}` : ""}`}
      />
      {saved ? <Alert tone="success" title={saved} className="mb-6" /> : null}
      {r.incoming ? (
        <Alert tone="warning" title="The latest import has different text for this reading." className="mb-6">
          A correction made here was kept instead. Compare the new source text below, then keep the correction or use the new text.
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
        <Card>
          <SectionHeading description="Exactly as members will see it.">Preview</SectionHeading>
          <ReadingView collection={c} reading={r} date={dateInYear(year, r.month, r.day)} reflectionId={null} member={false} />
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionHeading>
              Correct this reading {r.edited ? <Badge tone="info">Corrected</Badge> : null}
            </SectionHeading>
            {locked ? <Alert tone="info" title="This collection is published. A content publisher corrects its readings." className="mb-4" /> : null}
            {/* Keyed by revision: after a save or restore the form starts over from the stored text. */}
            <ReadingForm key={r.revision} reading={form} locked={locked} />
          </Card>
          {r.incoming ? (
            <Card>
              <SectionHeading>New source text (not applied)</SectionHeading>
              <TextPreview text={r.incoming} />
              {locked ? null : (
                <div className="mt-3">
                  <RestoreForm key={r.revision} reading={form} importId={r.incoming.import_id} label="Use the new source text" />
                </div>
              )}
            </Card>
          ) : null}
          {r.edited ? (
            <Card>
              <SectionHeading>Imported text</SectionHeading>
              <TextPreview text={r.imported} />
              {locked ? null : (
                <div className="mt-3">
                  <RestoreForm key={r.revision} reading={form} label="Restore the imported text" />
                </div>
              )}
            </Card>
          ) : null}
          {r.revisions.length ? (
            <Card>
              <SectionHeading>Earlier versions</SectionHeading>
              <ol className="space-y-3">
                {r.revisions.map((v) => (
                  <li key={v.revision}>
                    <details className="text-meta">
                      <summary className="cursor-pointer font-semibold">
                        Revision {v.revision}, {REPLACED[v.replaced_by]} {formatDateTime(v.changed_at, tz)}
                        {v.changed_by ? ` by ${v.changed_by}` : ""}
                      </summary>
                      <div className="mt-2">
                        <TextPreview text={v} />
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TextPreview({ text }: { text: { key_verse: string; scripture_ref: string; body: string } }) {
  return (
    <div className="space-y-2 text-meta">
      <p className="font-semibold [overflow-wrap:anywhere]">
        {text.key_verse} — {text.scripture_ref}
      </p>
      {bodyBlocks(text.body).map((b, i) =>
        b.kind === "paragraph" ? (
          <p key={i} className="[overflow-wrap:anywhere]">
            {b.text}
          </p>
        ) : (
          <p key={i} className="border-l-2 border-border pl-3">
            {b.lines.map((l, n) => (
              <span key={n} className="block">
                {l}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
