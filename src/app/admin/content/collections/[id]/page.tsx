import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportReportView, ImportResultView } from "@/components/devotionals/import-report";
import { collectionHref } from "@/components/devotionals/reading-view";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, rowListClass, SectionHeading } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { CheckboxField, fieldControlClass } from "@/components/ui/field";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import type { AdminReadingRow, CollectionAdmin } from "@/lib/devotionals/types";
import { isUuid } from "@/lib/media/format";
import { getChurchSettings } from "@/lib/settings/queries";
import { requireClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { loadEditorData } from "../../editor-data";
import { discardImportAction } from "../actions";
import { DetailsForm, RemoveForm, StatusButtons } from "../forms";
import { STATE_BADGE } from "../state";

export const metadata: Metadata = { title: "Devotional collection" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SAVED: Record<string, string> = {
  publish: "Published. Members can read it now.",
  unpublish: "Returned to draft. Members can no longer see it.",
  hide: "Hidden. Members can no longer find or open it; nothing was deleted.",
  show: "Shown to members again.",
  details: "Details saved.",
};
const PAGE = 62;

export default async function CollectionAdminPage({ params, searchParams }: PageProps<"/admin/content/collections/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const viewer = await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], `/admin/content/collections/${id}`);
  const sp = await searchParams;
  const month = typeof sp.month === "string" && /^([1-9]|1[0-2])$/.test(sp.month) ? Number(sp.month) : null;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const edited = sp.edited === "1";
  const page = typeof sp.page === "string" && /^\d{1,2}$/.test(sp.page) ? Math.max(1, Number(sp.page)) : 1;
  // With no filter, open on the current month rather than all 732 readings.
  const supabase = await requireClient();
  const [{ settings }, detail, editor] = await Promise.all([getChurchSettings(), supabase.rpc("media_admin_collection", { p_id: id }), loadEditorData(supabase)]);
  if (detail.error?.code === "P0002") notFound();
  if (detail.error || !detail.data) return <Alert tone="error" title="This collection couldn't be loaded right now." />;
  const c = detail.data as CollectionAdmin;
  const tz = settings.timezone;
  const filterMonth = month ?? (q || edited ? null : Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(new Date())));
  const list = await supabase.rpc("media_admin_collection_readings", {
    p_id: id,
    p_month: filterMonth,
    p_q: q || null,
    p_edited: edited,
    p_limit: PAGE,
    p_offset: (page - 1) * PAGE,
  });
  const readings = ((list.data as { items: AdminReadingRow[] } | null)?.items ?? []) as AdminReadingRow[];
  const total = (list.data as { total: number } | null)?.total ?? 0;
  const canPublish = viewer.capabilities.has(CAPABILITIES.contentPublish);
  const saved = typeof sp.saved === "string" ? SAVED[sp.saved] : undefined;
  const importedId = typeof sp.imported === "string" ? sp.imported : null;
  const imported = importedId ? c.imports?.find((i) => i.id === importedId) : undefined;
  const staging = c.imports?.find((i) => i.status === "staging");
  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    if (filterMonth) qs.set("month", String(filterMonth));
    if (q) qs.set("q", q);
    if (edited) qs.set("edited", "1");
    if (p > 1) qs.set("page", String(p));
    return `/admin/content/collections/${id}?${qs}`;
  };

  return (
    <div className="layout-wide">
      <PageHeader
        eyebrow={
          <Link href="/admin/content/collections" className="hover:underline">
            Devotional collections
          </Link>
        }
        title={c.title}
        description={`${c.readings.toLocaleString("en-US")} readings (${c.mornings} morning, ${c.evenings} evening) · ${c.edited} corrected · last changed ${formatDateTime(c.updated_at, tz)}`}
      />
      {saved ? <Alert tone="success" title={saved} className="mb-6" /> : null}
      {imported?.result ? (
        <Alert tone="success" title="Import finished." className="mb-6">
          <ImportResultView result={imported.result} />
        </Alert>
      ) : null}
      {staging ? (
        <Alert tone="warning" title="An import is in progress or was interrupted." className="mb-6">
          Started {formatDateTime(staging.created_at, tz)}; {staging.staged} of {staging.expected_count} readings staged. Nothing from it has reached the readings.
          {canPublish ? (
            <form action={discardImportAction} className="mt-2">
              <input type="hidden" name="import_id" value={staging.id} />
              <input type="hidden" name="collection_id" value={c.id} />
              <Button type="submit" size="sm" variant="secondary">
                Discard it
              </Button>
            </form>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="min-w-0 space-y-6">
          <Card>
            <SectionHeading description="Review every reading before publishing. Open one to read it as members will, or to correct it.">Readings</SectionHeading>
            <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col text-meta font-semibold">
                Month
                <select name="month" defaultValue={filterMonth ? String(filterMonth) : ""} className={cn(fieldControlClass, "mt-1 w-auto border-border-strong appearance-auto pr-8")}>
                  <option value="">All months</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-48 flex-1 flex-col text-meta font-semibold">
                Search
                <input type="search" name="q" defaultValue={q} maxLength={100} className={cn(fieldControlClass, "mt-1 border-border-strong")} />
              </label>
              <CheckboxField label="Corrected only" name="edited" value="1" defaultChecked={edited} />
              <Button type="submit" variant="secondary" size="sm">
                Filter
              </Button>
            </form>
            <p className="mb-2 text-meta text-text-secondary" role="status">
              {total.toLocaleString("en-US")} {total === 1 ? "reading" : "readings"}
              {filterMonth ? ` in ${MONTHS[filterMonth - 1]}` : ""}
              {q ? ` matching “${q}”` : ""}
              {edited ? ", corrected only" : ""}
            </p>
            {readings.length ? (
              <ul className={rowListClass}>
                {readings.map((r) => (
                  <li key={r.id}>
                    <Link href={`/admin/content/collections/${c.id}/readings/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-surface-muted/60">
                      <span className="w-40 shrink-0 font-semibold text-text">{r.label}</span>
                      <span className="min-w-0 flex-1 text-meta text-text-secondary">
                        <span className="line-clamp-1 [overflow-wrap:anywhere]">{r.key_verse}</span>
                        <span className="block">{r.scripture_ref}</span>
                      </span>
                      {r.edited ? <Badge tone="info">Corrected</Badge> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-meta">No readings match.</p>
            )}
            {total > PAGE ? (
              <nav aria-label="Reading pages" className="mt-4 flex items-center justify-between gap-2">
                {page > 1 ? (
                  <ButtonLink href={pageHref(page - 1)} variant="secondary" size="sm">
                    Previous
                  </ButtonLink>
                ) : (
                  <span />
                )}
                <span className="text-meta text-text-secondary">
                  Page {page} of {Math.ceil(total / PAGE)}
                </span>
                {page * PAGE < total ? (
                  <ButtonLink href={pageHref(page + 1)} variant="secondary" size="sm">
                    Next
                  </ButtonLink>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </Card>

          <Card>
            <SectionHeading>Details</SectionHeading>
            {editor ? (
              <DetailsForm
                key={c.updated_at}
                collection={c}
                groups={editor.options.groups}
                canUpload={editor.options.can_manage_media}
                canPublish={canPublish}
                imageMaxMb={editor.imageMaxMb}
              />
            ) : (
              <Alert tone="error" title="The editor couldn't be loaded." />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHeading>Publishing</SectionHeading>
            <p className="mb-2">
              <Badge tone={STATE_BADGE[c.state].tone}>{STATE_BADGE[c.state].label}</Badge>
            </p>
            <p className="mb-3 text-meta text-text-secondary">
              Members see a collection only while it is published and shown, and only if they are{" "}
              {c.audience === "group" ? `in ${c.group_name ?? "the group"}` : "approved adult members"}. Hiding keeps everything; members&apos; journal entries keep their
              text either way.
            </p>
            {c.state === "live" ? (
              <p className="mb-3">
                <Link href={collectionHref(c.key)} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                  Open as members see it <ExternalLink className="size-3.5" aria-hidden="true" />
                </Link>
              </p>
            ) : null}
            {canPublish ? <StatusButtons collection={c} /> : <p className="text-meta text-text-secondary">A content publisher publishes, hides, and imports.</p>}
          </Card>

          <Card>
            <SectionHeading>Provenance</SectionHeading>
            <dl className="space-y-2 text-meta [overflow-wrap:anywhere]">
              <div>
                <dt className="font-semibold text-text-secondary">Author</dt>
                <dd>{c.author}</dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">Rights</dt>
                <dd>
                  {c.rights === "public_domain" ? "Public domain. " : ""}
                  {c.rights_statement}
                </dd>
              </div>
              {c.text_source_url ? (
                <div>
                  <dt className="font-semibold text-text-secondary">Text source</dt>
                  <dd>
                    <a href={c.text_source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                      {c.text_source_url}
                      <span className="sr-only"> (opens a new tab)</span>
                    </a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="font-semibold text-text-secondary">Data file</dt>
                <dd>
                  {c.source.repository} · {c.source.path} · commit {c.source.commit}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">SHA-256</dt>
                <dd>{c.source.sha256}</dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">Licence</dt>
                <dd>{c.source.license_notice}</dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">Last imported</dt>
                <dd>{c.source.imported_at ? formatDateTime(c.source.imported_at, tz) : "never"}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <SectionHeading action={canPublish ? <Link href="/admin/content/collections/import" className="min-h-11 px-2 text-meta font-semibold text-primary hover:underline">Import again</Link> : null}>
              Imports
            </SectionHeading>
            {c.imports?.length ? (
              <ol className="space-y-4">
                {c.imports.map((i) => (
                  <li key={i.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                    <p className="text-meta font-semibold">
                      {formatDateTime(i.created_at, tz)} · {i.created_by ?? "someone"} ·{" "}
                      <Badge tone={i.status === "applied" ? "success" : i.status === "failed" ? "danger" : i.status === "staging" ? "warning" : "neutral"}>{i.status}</Badge>
                    </p>
                    <p className="text-meta text-text-secondary">commit {i.source_commit.slice(0, 12)}</p>
                    {i.result ? <ImportResultView result={i.result} /> : null}
                    {i.error ? <p className="text-meta text-danger">{i.error}</p> : null}
                    {i.report?.fixes ? (
                      <details className="mt-1 text-meta">
                        <summary className="cursor-pointer font-semibold text-primary">Dry-run report</summary>
                        <div className="mt-2">
                          <ImportReportView report={i.report} />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-meta">No imports yet.</p>
            )}
          </Card>

          {canPublish ? (
            <Card>
              <SectionHeading>Remove this collection</SectionHeading>
              {c.status === "published" && c.enabled ? (
                <p className="text-meta text-text-secondary">Hide it first. Hiding is usually enough: it can be shown again, and nothing is lost.</p>
              ) : (
                <RemoveForm collection={c} />
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
