import { ArrowDown, ArrowLeft, ArrowUp, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CollectionCreateForm } from "@/components/prayer/collection-admin-forms";
import { PrayerCollectionFolder, collectionGridClass } from "@/components/prayer/collection-folder";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { signCollectionCovers } from "@/lib/prayer/collection-covers";
import { prayerCount, type AdminCollection } from "@/lib/prayer/library";
import { createClient } from "@/lib/supabase/server";
import { moveCollectionAction } from "../collection-actions";

export const metadata: Metadata = { title: "Prayer Library collections" };

const LIST = "/admin/prayer/library/collections";

/**
 * Settings managers: the Prayer Library's collections in the order members
 * see them, a preview of each card, and a form to add one. Each collection's
 * editor handles its cover, its prayers, and archiving.
 */
export default async function PrayerCollectionsAdminPage() {
  await requireCapability(CAPABILITIES.settingsManage, LIST);
  const list = await tryCommunityRpc<AdminCollection[]>("prayer_library_admin_collections");
  const supabase = list?.some((c) => c.cover) ? await createClient() : null;
  const covers = supabase && list ? await signCollectionCovers(supabase, list.map((c) => c.cover?.path)) : new Map<string, string>();
  const active = (list ?? []).filter((c) => !c.archived);
  const archived = (list ?? []).filter((c) => c.archived);

  return (
    <>
      <Link href="/admin/prayer/library" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer Library moderation
      </Link>
      <PageHeader
        title="Prayer Library collections"
        description="Collections are the shelves members browse. Every published prayer is filed in one; members choose it when they publish, and you can move prayers here. Collections without a published prayer stay out of members' view."
      />
      {!list ? (
        <Alert tone="error" title="Collections couldn't be loaded." />
      ) : (
        <div className="space-y-10">
          <section aria-labelledby="col-active" className="space-y-3">
            <SectionHeading id="col-active" description="Members see them in this order. Moving one changes the order for everyone.">
              Active collections
            </SectionHeading>
            <ol className="space-y-2">
              {active.map((c, i) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`${LIST}/${c.id}`} className="font-semibold text-primary hover:underline [overflow-wrap:anywhere]">
                        {c.name}
                      </Link>
                      {c.is_general ? <Badge tone="neutral">For prayers that fit nowhere else</Badge> : null}
                      {c.counts.published === 0 ? <Badge tone="warning">Not shown to members</Badge> : null}
                    </p>
                    <p className="text-meta text-text-secondary">
                      {prayerCount(c.counts.published)} published
                      {c.counts.hidden ? ` · ${c.counts.hidden} hidden` : ""}
                      {c.counts.archived ? ` · ${c.counts.archived} archived` : ""}
                      {c.cover ? " · has a cover" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {(["up", "down"] as const).map((d) => {
                      const edge = d === "up" ? i === 0 : i === active.length - 1;
                      return (
                        <form key={d} action={moveCollectionAction}>
                          <input type="hidden" name="collectionId" value={c.id} />
                          <input type="hidden" name="direction" value={d} />
                          <button
                            type="submit"
                            disabled={edge}
                            className="inline-flex size-11 items-center justify-center rounded-full border border-border-strong bg-surface hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {d === "up" ? <ArrowUp className="size-4" aria-hidden="true" /> : <ArrowDown className="size-4" aria-hidden="true" />}
                            <span className="sr-only">
                              Move {c.name} {d}
                            </span>
                          </button>
                        </form>
                      );
                    })}
                    <Link href={`${LIST}/${c.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold text-primary hover:bg-surface-muted">
                      <Pencil className="size-4" aria-hidden="true" /> Edit<span className="sr-only"> {c.name}</span>
                    </Link>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="col-preview" className="space-y-3">
            <SectionHeading id="col-preview" description="The cards as members see them (only collections with a published prayer appear).">
              Member preview
            </SectionHeading>
            <div inert>
              <ul className={collectionGridClass}>
                {active
                  .filter((c) => c.counts.published > 0)
                  .map((c) => (
                    <li key={c.id}>
                      <PrayerCollectionFolder href={`${LIST}/${c.id}`} collection={c} src={c.cover ? covers.get(c.cover.path) : null} />
                    </li>
                  ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="col-new">
            <SectionHeading id="col-new">Add a collection</SectionHeading>
            <Card className="max-w-xl">
              <CollectionCreateForm />
            </Card>
          </section>

          {archived.length ? (
            <section aria-labelledby="col-archived" className="space-y-3">
              <SectionHeading id="col-archived" description="Members don't see these. Restore one from its editor.">
                Archived collections
              </SectionHeading>
              <ul className="space-y-2">
                {archived.map((c) => (
                  <li key={c.id}>
                    <Link href={`${LIST}/${c.id}`} className="block rounded-card border border-border bg-surface px-4 py-3 font-semibold hover:bg-surface-muted">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
