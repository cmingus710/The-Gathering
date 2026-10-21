import { ChevronRight, FileText, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { formatBytes } from "@/lib/media/files";
import { requireClient } from "@/lib/supabase/server";
import { removeReferenceAction } from "./actions";
import { TranslationForm, type AdminTranslation } from "./translation-form";
import { ReferencePdfPanel } from "./upload-panels";

export const metadata: Metadata = { title: "Bible sources" };
// Processing a reference PDF runs in this page's server actions.
export const maxDuration = 120;

type Sources = {
  translations: AdminTranslation[];
  imports: Array<{ id: string; translation_code: string; status: string; original_name: string; rows_staged: number; created_at: string }>;
  references: Array<{ id: string; translation_label: string; source: string; status: string; original_name: string; size_bytes: number; page_count: number | null; text_layer: string | null; error: string | null; created_at: string }>;
};

const LAYER: Record<string, string> = { present: "Selectable text", absent: "Scanned images (no text layer)", mixed: "Text and scanned pages", unknown: "Couldn't tell" };

export default async function SourcesPage() {
  await requireCapability(CAPABILITIES.bibleManage, "/admin/bible/sources");
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_admin_sources");
  const s = (data ?? { translations: [], imports: [], references: [] }) as Sources;

  return (
    <>
      <p className="mb-4">
        <Link href="/admin/bible" className="font-semibold text-primary hover:underline">
          Reading plans
        </Link>
      </p>
      <PageHeader
        title="Bible sources"
        description="Translations members can read, where their text comes from, and what each license allows. Scripture is never generated, altered, or mixed between translations."
      />
      {error ? <Alert tone="error" title="Sources couldn't be loaded right now." className="mb-4" /> : null}

      <section aria-labelledby="translations" className="mb-8">
        <SectionHeading id="translations">Translations</SectionHeading>
        {s.translations.length ? (
          <ul className={rowListClass}>
            {s.translations.map((t) => (
              <li key={t.id}>
                <ListRow
                  plain
                  href={`/admin/bible/sources/${t.id}`}
                  label={`${t.code} · ${t.name}`}
                  description={[
                    t.source_kind === "database" ? `${t.verse_count.toLocaleString("en-US")} verses stored` : "Licensed API",
                    t.rights === "unverified" || !t.rights_confirmed_at ? "rights not confirmed" : t.rights.replace("_", " "),
                    t.plans ? `${t.plans} plans` : null,
                  ].filter(Boolean).join(" · ")}
                  trailing={
                    <span className="flex items-center gap-2">
                      {t.is_default ? <Badge tone="warning">Default</Badge> : null}
                      <Badge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Active" : t.status === "draft" ? "Not active" : "Retired"}</Badge>
                      <ChevronRight className="size-5" aria-hidden="true" />
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState glyph="bible" title="No translations yet">
            Add the church&apos;s approved translation. Until the church chooses one, the public-domain World English Bible (WEB) can be imported for testing (see the Bible sources guide).
          </EmptyState>
        )}
      </section>

      <Card className="mb-8">
        <SectionHeading as="h2">Add a translation</SectionHeading>
        <TranslationForm t={null} />
      </Card>

      {s.imports.length ? (
        <section aria-labelledby="imports" className="mb-8">
          <SectionHeading id="imports">Recent text imports</SectionHeading>
          <ul className={rowListClass}>
            {s.imports.map((i) => (
              <li key={i.id}>
                <ListRow plain href={`/admin/bible/sources/imports/${i.id}`} label={`${i.translation_code}: ${i.original_name}`} description={`${i.status} · ${i.rows_staged.toLocaleString("en-US")} lines`} trailing={<ChevronRight className="size-5" aria-hidden="true" />} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="refs">
        <SectionHeading id="refs" description="Bible PDFs kept for administrators' reference only. Their text is never shown to members; use a structured import or a licensed API for member-facing text.">
          Reference PDFs
        </SectionHeading>
        {s.references.length ? (
          <ul className={`${rowListClass} mb-4`}>
            {s.references.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  {r.status === "ready" ? (
                    <a href={`/api/bible/references/${r.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">
                      {r.translation_label}
                    </a>
                  ) : (
                    <span className="font-semibold">{r.translation_label}</span>
                  )}
                  <span className="block text-meta text-text-secondary">
                    {[r.original_name, formatBytes(r.size_bytes), r.page_count ? `${r.page_count} pages` : null, r.text_layer ? LAYER[r.text_layer] : null, r.status !== "ready" ? r.status : null, r.error].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <ConfirmDialog
                  triggerVariant="ghost"
                  trigger={
                    <>
                      <Trash2 className="size-4" aria-hidden="true" />
                      <span className="sr-only">Remove {r.translation_label}</span>
                    </>
                  }
                  title={`Remove the ${r.translation_label} reference PDF?`}
                  confirmLabel="Remove PDF"
                  formAction={removeReferenceAction}
                  hidden={{ id: r.id }}
                >
                  The file is deleted from storage. This can&apos;t be undone.
                </ConfirmDialog>
              </li>
            ))}
          </ul>
        ) : null}
        <Card>
          <ReferencePdfPanel />
        </Card>
      </section>
    </>
  );
}
