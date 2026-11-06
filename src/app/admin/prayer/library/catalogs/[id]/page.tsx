import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CatalogDetailsForm,
  CatalogPublishAllForm,
  CatalogReviewForm,
  CatalogStatusForm,
  CatalogTopicRow,
  DiscardCatalogImportForm,
} from "@/components/prayer/catalog-admin-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Select } from "@/components/ui/select";
import { segmentClass } from "@/components/ui/segmented";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { pick } from "@/lib/prayer/format";
import {
  CATALOG_ADMIN_PAGE,
  CATALOG_REVIEW_LABEL,
  CATALOG_REVIEW_STATES,
  CATALOG_STATUS_LABEL,
  adminCatalogHref,
  catalogHref,
  catalogOffset,
  catalogRange,
  pickTopic,
  type AdminCatalogDetail,
  type AdminCatalogLinkPage,
  type CatalogReviewState,
} from "@/lib/prayer/catalog";

export const metadata: Metadata = { title: "Prayer link catalogue" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One prayer link catalogue for settings managers: its details and whether
 * members can see it, its topics, the review list where links are published
 * or unpublished, and the imports that built it. No prayer text is here.
 */
export default async function PrayerCatalogAdminPage({ params, searchParams }: PageProps<"/admin/prayer/library/catalogs/[id]">) {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/prayer/library/catalogs");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const catalog = await tryCommunityRpc<AdminCatalogDetail>("prayer_link_admin_catalog", { p_id: id });
  if (!catalog) notFound();

  const state = pick(sp.state, CATALOG_REVIEW_STATES, "unpublished") as CatalogReviewState;
  const topic = pickTopic(sp.topic, catalog.topics);
  const query = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const { page: pageNo, offset } = catalogOffset(sp.page, CATALOG_ADMIN_PAGE);
  const page = await tryCommunityRpc<AdminCatalogLinkPage>("prayer_link_admin_list", {
    p_catalog: catalog.id,
    p_query: query || null,
    p_topic: topic,
    p_state: state,
    p_limit: CATALOG_ADMIN_PAGE,
    p_offset: offset,
  });

  const base = adminCatalogHref(catalog.id);
  const href = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ state, topic, q: query || null, ...extra })) if (v && v !== "unpublished") p.set(k, v);
    return p.size ? `${base}?${p}` : base;
  };
  const staging = catalog.imports.find((i) => i.status === "staging") ?? null;
  const last = catalog.imports.find((i) => i.status === "applied") ?? null;
  const topicRow = catalog.topics.find((t) => t.id === topic) ?? null;

  return (
    <>
      <Link href="/admin/prayer/library/catalogs" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer link catalogues
      </Link>
      <PageHeader
        title={catalog.name}
        description={`${catalog.counts.total.toLocaleString("en-US")} prayer links from ${catalog.source_name}, in ${catalog.topic_counts.active.toLocaleString("en-US")} of its topics. Titles, labels, and links only — the prayers' words stay on their site.`}
      />
      {sp.imported ? <Alert tone="success" title="Imported. Nothing is visible to members until you publish it." className="mb-4" /> : null}
      {sp.discarded ? <Alert tone="success" title="The unfinished import was discarded. Nothing was changed." className="mb-4" /> : null}
      {staging ? (
        <Alert tone="warning" title="An import was left unfinished." className="mb-4">
          <p className="mb-2">Nothing it staged has been applied. Discard it before importing again.</p>
          <DiscardCatalogImportForm catalogId={catalog.id} importId={staging.id} />
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="space-y-6">
          <Card>
            <SectionHeading description="Published links, the ones still waiting, and the ones the source dropped.">Review prayer links</SectionHeading>
            <form method="get" action={base} className="mb-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="state" value={state} />
              <div className="min-w-0 flex-1 basis-full sm:basis-64">
                <label htmlFor="admin-catalog-q" className="mb-1 block text-meta font-semibold text-text-secondary">
                  Search titles and topics
                </label>
                <input
                  id="admin-catalog-q"
                  name="q"
                  type="search"
                  defaultValue={query}
                  maxLength={100}
                  className="block min-h-11 w-full rounded-full border border-border-strong bg-surface px-4 text-base text-text focus-visible:outline-3 focus-visible:outline-primary"
                />
              </div>
              <div className="min-w-0 flex-1 basis-full sm:basis-56">
                <label htmlFor="admin-catalog-topic" className="mb-1 block text-meta font-semibold text-text-secondary">
                  Topic
                </label>
                <Select
                  id="admin-catalog-topic"
                  name="topic"
                  defaultValue={topic ?? ""}
                  className="block min-h-11 w-full rounded-full border border-border-strong bg-surface px-4 text-base text-text focus-visible:outline-3 focus-visible:outline-primary"
                >
                  <option value="">Every topic</option>
                  {catalog.topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.total.toLocaleString("en-US")})
                      {t.archived ? " · archived" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="primary">
                Filter
              </Button>
              {query || topic ? (
                <ButtonLink href={href({ q: null, topic: null })} variant="ghost">
                  Clear
                </ButtonLink>
              ) : null}
            </form>

            <nav aria-label="Which links to show" className="mb-4 flex flex-wrap gap-1">
              {CATALOG_REVIEW_STATES.map((s) => (
                <Link key={s} href={href({ state: s, page: null })} className={cn(segmentClass(s === state), "whitespace-nowrap")} aria-current={s === state ? "page" : undefined}>
                  {CATALOG_REVIEW_LABEL[s]}
                </Link>
              ))}
            </nav>

            {!page ? (
              <Alert tone="error" title="Prayer links couldn't be loaded." />
            ) : page.items.length ? (
              <div className="space-y-3">
                <p className="text-meta text-text-secondary">
                  {catalogRange(page.total, offset, page.items.length)}
                  {topicRow ? ` in ${topicRow.name}` : ""}
                </p>
                <CatalogReviewForm catalogId={catalog.id} items={page.items} />
                <div className="flex flex-wrap gap-2">
                  {pageNo > 1 ? (
                    <ButtonLink href={href({ page: pageNo > 2 ? String(pageNo - 1) : null })} variant="secondary" size="sm">
                      Previous
                    </ButtonLink>
                  ) : null}
                  {page.has_more ? (
                    <ButtonLink href={href({ page: String(pageNo + 1) })} variant="secondary" size="sm">
                      Next
                    </ButtonLink>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-text-secondary">Nothing here{query || topic ? " matches those filters" : ""}.</p>
            )}

            <div className="mt-6 border-t border-border pt-4">
              <h3 className="mb-2 font-semibold text-text">{topicRow ? `Everything in ${topicRow.name}` : "Everything in this category"}</h3>
              <CatalogPublishAllForm catalog={catalog} topic={topicRow} />
            </div>
          </Card>

          <Card>
            <SectionHeading description="The source's own topics, kept as it words them. Archiving one removes it from the member filters and from the labels on each prayer; the links themselves stay.">
              Topics
            </SectionHeading>
            {catalog.topics.length ? (
              <div className="divide-y divide-border rounded-card border border-border">
                {catalog.topics.map((t) => (
                  <CatalogTopicRow key={t.id} catalogId={catalog.id} topic={t} />
                ))}
              </div>
            ) : (
              <p className="text-text-secondary">No topics yet.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHeading>Who can see it</SectionHeading>
            <CatalogStatusForm catalog={catalog} />
            {catalog.status === "published" && catalog.counts.published ? (
              <p className="mt-3 text-meta">
                <Link href={catalogHref(catalog.id)} className="font-semibold text-primary hover:underline">
                  See it as a member does
                </Link>
              </p>
            ) : null}
          </Card>

          <Card>
            <SectionHeading>Details</SectionHeading>
            <CatalogDetailsForm catalog={catalog} />
          </Card>

          <Card>
            <SectionHeading>Source</SectionHeading>
            <dl className="space-y-2 text-meta [overflow-wrap:anywhere]">
              <div>
                <dt className="font-semibold text-text-secondary">Site</dt>
                <dd>
                  <a href={catalog.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                    {catalog.source_name}
                    <ExternalLink className="ml-1 inline size-3.5 align-text-top" aria-hidden="true" />
                    <span className="sr-only"> (opens a new tab)</span>
                  </a>
                </dd>
              </div>
              {catalog.rights_statement ? (
                <div>
                  <dt className="font-semibold text-text-secondary">Rights</dt>
                  <dd>{catalog.rights_statement}</dd>
                </div>
              ) : null}
              {catalog.source_path ? (
                <div>
                  <dt className="font-semibold text-text-secondary">Pinned file</dt>
                  <dd>{catalog.source_path}</dd>
                </div>
              ) : null}
              {catalog.source_sha256 ? (
                <div>
                  <dt className="font-semibold text-text-secondary">SHA-256</dt>
                  <dd>{catalog.source_sha256}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card>
            <SectionHeading description="Counts only; no prayer text is ever recorded.">Imports</SectionHeading>
            {catalog.imports.length ? (
              <ul className="space-y-3 text-meta">
                {catalog.imports.map((i) => (
                  <li key={i.id} className="space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={i.status === "applied" ? "success" : i.status === "failed" ? "danger" : "neutral"}>{i.status}</Badge>
                      <span className="text-text-secondary">
                        {new Date(i.created_at).toISOString().slice(0, 10)} · {i.by}
                      </span>
                    </span>
                    {i.result ? (
                      <span className="block text-text-secondary">
                        {Object.entries(i.result)
                          .filter(([, v]) => typeof v === "number")
                          .map(([k, v]) => `${k.replace(/_/g, " ")} ${Number(v).toLocaleString("en-US")}`)
                          .join(" · ")}
                      </span>
                    ) : null}
                    {i.error ? <span className="block text-danger">{i.error}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-secondary">No imports recorded.</p>
            )}
            {last ? null : <p className="mt-2 text-meta text-text-secondary">Nothing has been applied yet.</p>}
            <p className="mt-3 text-meta">
              <Link href="/admin/prayer/library/catalogs" className="font-semibold text-primary hover:underline">
                Run the import
              </Link>{" "}
              · status {CATALOG_STATUS_LABEL[catalog.status].toLowerCase()}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
