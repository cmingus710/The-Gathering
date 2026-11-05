import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CatalogImportForm } from "@/components/prayer/catalog-admin-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { CATALOG_STATUS_LABEL, CATHOLIC_ONLINE, adminCatalogHref, type AdminCatalogSummary } from "@/lib/prayer/catalog";
import { prepareCatholicOnline } from "@/lib/prayer/catalog-source";

export const metadata: Metadata = { title: "Prayer link catalogues" };

/**
 * Church settings managers: prayer categories whose prayers live on another
 * site. This page runs the pinned catalogue's dry run on every visit
 * (nothing is written) and imports it; each catalogue's own page is where
 * links are reviewed and published. No prayer text is read or stored.
 */
export default async function PrayerCatalogsPage() {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/prayer/library/catalogs");
  const [catalogs, prepared] = await Promise.all([
    tryCommunityRpc<AdminCatalogSummary[]>("prayer_link_admin_catalogs"),
    prepareCatholicOnline(),
  ]);
  const existing = (catalogs ?? []).find((c) => c.key === CATHOLIC_ONLINE.key) ?? null;
  const report = prepared.ok ? prepared.report : null;

  return (
    <>
      <Link href="/admin/prayer/library" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer Library moderation
      </Link>
      <PageHeader
        title="Prayer link catalogues"
        description="Prayer categories whose prayers are published on someone else's site. The church keeps each prayer's title, the source's topic labels, and a link to the page it is on — never the prayer's words. Imported links start unpublished, so members see nothing until you publish them."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="space-y-6">
          <Card>
            <SectionHeading description="Everything imported so far.">Catalogues</SectionHeading>
            {!catalogs ? (
              <Alert tone="error" title="Catalogues couldn't be loaded." />
            ) : catalogs.length ? (
              <ul className="divide-y divide-border">
                {catalogs.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <Link href={adminCatalogHref(c.id)} className="block font-semibold text-primary hover:underline [overflow-wrap:anywhere]">
                        {c.name}
                      </Link>
                      <span className="block text-meta text-text-secondary">
                        {c.source_name} · {c.counts.published.toLocaleString("en-US")} published of {c.counts.total.toLocaleString("en-US")}
                        {c.counts.retired ? ` · ${c.counts.retired.toLocaleString("en-US")} no longer listed` : ""} · {c.topic_counts.active.toLocaleString("en-US")} topics
                      </span>
                    </span>
                    <Badge tone={c.status === "published" ? "success" : c.status === "archived" ? "neutral" : "warning"}>{CATALOG_STATUS_LABEL[c.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-secondary">Nothing imported yet. Run the import on the right.</p>
            )}
          </Card>

          <Card>
            <SectionHeading description="Computed from the pinned files on every visit. Nothing is written.">Dry run</SectionHeading>
            {!prepared.ok ? (
              <Alert tone="error" title={prepared.message} />
            ) : (
              <>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Prayer links", report!.counts.links.toLocaleString("en-US")],
                    ["Topics", report!.counts.topics.toLocaleString("en-US")],
                    ["Records read", report!.counts.records.toLocaleString("en-US")],
                    ["Topic labels applied", report!.counts.topic_links.toLocaleString("en-US")],
                    ["Titles re-decoded", report!.corrections.mojibake.toLocaleString("en-US")],
                    ["Titles re-spaced", report!.corrections.whitespace.toLocaleString("en-US")],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-tile border border-border px-3 py-2">
                      <dt className="text-meta text-text-secondary">{label}</dt>
                      <dd className="text-title font-semibold text-text">{value}</dd>
                    </div>
                  ))}
                </dl>
                {report!.samples.length ? (
                  <div className="mt-4">
                    <h3 className="mb-1 font-semibold text-text">Titles the import repairs</h3>
                    <p className="mb-2 text-meta text-text-secondary">
                      The source&apos;s file was written with mis-decoded accents. The import restores them; nothing else about a title changes.
                    </p>
                    <ul className="space-y-1 text-meta [overflow-wrap:anywhere]">
                      {report!.samples.slice(0, 5).map((s) => (
                        <li key={s.source_id}>
                          <span className="text-text-secondary">{s.from}</span> → <span className="font-semibold text-text">{s.to}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report!.warnings.length ? (
                  <div className="mt-4">
                    <h3 className="mb-1 font-semibold text-text">Warnings ({report!.warnings.length.toLocaleString("en-US")})</h3>
                    <ul className="list-disc space-y-1 pl-5 text-meta text-text-secondary">
                      {report!.warnings.slice(0, 5).map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-meta text-text-secondary">They don&apos;t block the import.</p>
                  </div>
                ) : null}
                {report!.problems.length ? (
                  <Alert tone="error" title={`${report!.problems.length} problems block the import`} className="mt-4">
                    <ul className="list-disc space-y-1 pl-5">
                      {report!.problems.slice(0, 10).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </Alert>
                ) : (
                  <Alert tone="success" title="Ready to import." className="mt-4" />
                )}
              </>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHeading>Import</SectionHeading>
            <ul className="mb-4 list-disc space-y-1 pl-5 text-meta">
              <li>Links go into an unpublished draft category for review. Members see nothing until you publish.</li>
              <li>All or nothing: if any link is refused, nothing is imported and the reason is recorded.</li>
              <li>Running it again keeps every publishing decision, updates titles the source changed, and hides links it dropped.</li>
              <li>No prayer text is fetched or stored, and no email, push, or in-app notices are sent.</li>
            </ul>
            {existing ? (
              <p className="mb-4 text-meta">
                <Link href={adminCatalogHref(existing.id)} className="font-semibold text-primary hover:underline">
                  {existing.name}
                </Link>{" "}
                already holds {existing.counts.total.toLocaleString("en-US")} links ({existing.counts.published.toLocaleString("en-US")} published).
              </p>
            ) : null}
            <CatalogImportForm disabled={!prepared.ok || !prepared.report.ok} rerun={!!existing} />
          </Card>

          <Card>
            <SectionHeading>Provenance</SectionHeading>
            <dl className="space-y-2 text-meta [overflow-wrap:anywhere]">
              <div>
                <dt className="font-semibold text-text-secondary">Source</dt>
                <dd>
                  <a href={CATHOLIC_ONLINE.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
                    {CATHOLIC_ONLINE.sourceName}
                    <ExternalLink className="ml-1 inline size-3.5 align-text-top" aria-hidden="true" />
                    <span className="sr-only"> (opens a new tab)</span>
                  </a>
                  , collected {CATHOLIC_ONLINE.collectedOn}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">Pinned file</dt>
                <dd>{CATHOLIC_ONLINE.localPath}</dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">SHA-256</dt>
                <dd>{CATHOLIC_ONLINE.sha256}</dd>
              </div>
              <div>
                <dt className="font-semibold text-text-secondary">Rights</dt>
                <dd>{CATHOLIC_ONLINE.rightsStatement}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
