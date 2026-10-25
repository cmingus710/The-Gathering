import { ArrowLeft, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionArchiveForm, CollectionDetailsForm, ReassignPrayersForm } from "@/components/prayer/collection-admin-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClasses } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { signCollectionCovers } from "@/lib/prayer/collection-covers";
import { collectionHref, decodeLibraryCursor, type AdminCollection, type AdminCollectionPrayers } from "@/lib/prayer/library";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Prayer Library collection" };

const LIST = "/admin/prayer/library/collections";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One collection's editor (settings managers): name, description, and cover
 * with a preview of the member card; the prayers filed in it (never anyone's
 * private drafts), to move one or many elsewhere; and archiving after review.
 */
export default async function PrayerCollectionAdminPage({ params, searchParams }: PageProps<"/admin/prayer/library/collections/[id]">) {
  const { id } = await params;
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  // Keyset cursor: the last row's published_at and id (same encoding as the member lists).
  const cursor = decodeLibraryCursor(sp.after);
  const [collection, all, prayers] = await Promise.all([
    tryCommunityRpc<AdminCollection>("prayer_library_admin_collection", { p_id: id }),
    tryCommunityRpc<AdminCollection[]>("prayer_library_admin_collections"),
    tryCommunityRpc<AdminCollectionPrayers>("prayer_library_admin_collection_prayers", {
      p_collection: id,
      p_query: q || null,
      p_before: cursor?.before ?? null,
      p_before_id: cursor?.beforeId ?? null,
      p_limit: 50,
    }),
  ]);
  if (!collection) notFound();
  const supabase = collection.cover ? await createClient() : null;
  const coverUrl = supabase && collection.cover ? ((await signCollectionCovers(supabase, [collection.cover.path])).get(collection.cover.path) ?? null) : null;
  const targets = (all ?? []).filter((c) => !c.archived && c.id !== collection.id).map((c) => ({ id: c.id, name: c.name }));
  const last = prayers?.items[prayers.items.length - 1];
  const next = prayers?.has_more && last?.published_at ? `${last.published_at}~${last.id}` : null;
  const page = (after: string | null) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (after) p.set("after", after);
    return p.size ? `${LIST}/${id}?${p}` : `${LIST}/${id}`;
  };

  return (
    <>
      <Link href={LIST} className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer Library collections
      </Link>
      <PageHeader
        title={collection.name}
        description={collection.is_general ? "For prayers that don't fit another collection. Existing prayers were placed here; move them to a better collection whenever you're ready." : null}
        actions={
          !collection.archived && collection.counts.published > 0 ? (
            <ButtonLink href={collectionHref(collection.id)} variant="secondary" size="sm">
              View as a member
            </ButtonLink>
          ) : null
        }
      />
      {sp.created ? <Alert tone="success" title="Collection created. Add a cover and description, then file prayers in it." className="mb-6" /> : null}
      {collection.archived ? <Alert tone="info" title="Archived: members don't see this collection, and it can't be chosen for prayers." className="mb-6" /> : null}

      <div className="space-y-10">
        <section aria-labelledby="col-details">
          <SectionHeading id="col-details">Details and cover</SectionHeading>
          <Card>
            <CollectionDetailsForm key={`${collection.updated_at}:${coverUrl ? collection.cover?.path : ""}`} collection={collection} coverUrl={coverUrl} />
          </Card>
        </section>

        <section aria-labelledby="col-prayers" className="space-y-3">
          <SectionHeading
            id="col-prayers"
            description="Published, hidden, and archived prayers filed here. Private drafts aren't listed: their contributors choose a collection when they publish."
          >
            Prayers in this collection
          </SectionHeading>
          <form role="search" action={`${LIST}/${id}`} className="flex max-w-xl gap-2">
            <label htmlFor="col-q" className="sr-only">
              Find prayers by title
            </label>
            <span className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              <input id="col-q" name="q" type="search" defaultValue={q} maxLength={100} placeholder="Find by title" className="min-h-11 w-full rounded-full border border-border-strong bg-surface pl-10 pr-4" />
            </span>
            <button type="submit" className={buttonClasses("secondary", "sm")}>
              Find
            </button>
          </form>
          {q ? (
            <p className="text-meta text-text-secondary">
              Titles matching “{q}”.{" "}
              <Link href={`${LIST}/${id}`} className="font-semibold text-primary hover:underline">
                Show all
              </Link>
            </p>
          ) : null}
          {!prayers ? (
            <Alert tone="error" title="These prayers couldn't be loaded." />
          ) : prayers.items.length ? (
            <>
              {targets.length ? (
                <ReassignPrayersForm key={`${q}:${sp.after ?? ""}:${prayers.items.map((p) => p.id).join(",")}`} collectionId={collection.id} prayers={prayers.items} targets={targets} />
              ) : (
                <p className="text-text-secondary">Add another collection to move prayers into.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {cursor ? (
                  <ButtonLink href={page(null)} variant="ghost" size="sm">
                    Back to newest
                  </ButtonLink>
                ) : null}
                {next ? (
                  <ButtonLink href={page(next)} variant="secondary" size="sm">
                    Show older prayers
                  </ButtonLink>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-text-secondary">{q ? "No titles match." : "No prayers are filed here."}</p>
          )}
        </section>

        <section aria-labelledby="col-archive" className="space-y-3">
          <SectionHeading id="col-archive">{collection.archived ? "Restore" : "Archive"}</SectionHeading>
          <Card className="max-w-xl">
            {collection.is_general ? (
              <p className="flex flex-wrap items-center gap-2 text-text-secondary">
                <Badge tone="neutral">Always available</Badge>
                General prayers can&apos;t be archived: it holds prayers that don&apos;t fit another collection.
              </p>
            ) : (
              <CollectionArchiveForm collection={collection} targets={targets} />
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
