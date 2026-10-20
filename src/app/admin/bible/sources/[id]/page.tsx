import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { isUuid } from "@/lib/media/format";
import { requireClient } from "@/lib/supabase/server";
import { TranslationForm, TranslationStatus, type AdminTranslation } from "../translation-form";
import { TextImportPanel } from "../upload-panels";

export const metadata: Metadata = { title: "Translation" };
// Staging a whole Bible runs in this page's server actions.
export const maxDuration = 120;

type Detail = AdminTranslation & { imports: Array<{ id: string; status: string; original_name: string; rows_staged: number; created_at: string; published_at: string | null }> };

export default async function TranslationPage({ params }: PageProps<"/admin/bible/sources/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  await requireCapability(CAPABILITIES.bibleManage, `/admin/bible/sources/${id}`);
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("bible_admin_translation", { p_id: id });
  if (error?.code === "P0002") notFound();
  if (error || !data) return <Alert tone="error" title="This translation couldn't be loaded right now." />;
  const t = data as Detail;
  const ready = t.rights !== "unverified" && !!t.rights_confirmed_at && (t.source_kind === "api" ? !!t.provider_ref && !!t.credential_env : t.verse_count > 0);

  return (
    <>
      <p className="mb-4">
        <Link href="/admin/bible/sources" className="font-semibold text-primary hover:underline">
          Bible sources
        </Link>
      </p>
      <PageHeader title={`${t.code} · ${t.name}`} description={t.source_kind === "database" ? `${t.verse_count.toLocaleString("en-US")} verses stored (text version ${t.text_version}).` : "Read from a licensed API on the server."} />
      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Active" : t.status === "draft" ? "Not active" : "Retired"}</Badge>
        {t.is_default ? <Badge tone="warning">Church default</Badge> : null}
        {!t.rights_confirmed_at ? <Badge tone="danger">Rights not confirmed</Badge> : null}
      </div>
      {t.source_kind === "api" ? (
        <Alert tone="warning" title="API sources aren't verified from this build" className="mb-6">
          The API.Bible adapter is tested only against recorded response shapes. Before activating, set the key in Vercel under the setting name below, confirm the provider&apos;s current terms (caching, verse limits, required notices, FUMS tracking), and check passages on a preview.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <Card>
          <TranslationForm t={t} />
        </Card>
        <div className="space-y-6">
          <Card>
            <SectionHeading as="h2" description={t.status === "active" ? "Members can read it and plans can use it." : ready ? "Ready to activate." : "Confirm the rights and publish text (or configure the API) first."}>
              Availability
            </SectionHeading>
            <TranslationStatus t={t} />
          </Card>
          {t.source_kind === "database" ? (
            <Card>
              <SectionHeading as="h2" description="Lines are staged for your review. Published text changes only when you publish a reviewed import.">
                Import text
              </SectionHeading>
              <TextImportPanel translationId={t.id} />
            </Card>
          ) : null}
          {t.imports.length ? (
            <section aria-labelledby="imports">
              <SectionHeading id="imports">Imports</SectionHeading>
              <ul className={rowListClass}>
                {t.imports.map((i) => (
                  <li key={i.id}>
                    <ListRow plain href={`/admin/bible/sources/imports/${i.id}`} label={i.original_name} description={`${i.status} · ${i.rows_staged.toLocaleString("en-US")} lines · ${new Date(i.created_at).toLocaleDateString("en-US")}`} trailing={<ChevronRight className="size-5" aria-hidden="true" />} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
