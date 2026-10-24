import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, rowListClass } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireAnyCapability } from "@/lib/auth/viewer";
import type { CollectionAdmin } from "@/lib/devotionals/types";
import { requireClient } from "@/lib/supabase/server";
import { STATE_BADGE } from "./state";

export const metadata: Metadata = { title: "Devotional collections" };

/** Imported devotional collections (Morning & Evening), beside the church's own devotionals. */
export default async function CollectionsPage({ searchParams }: PageProps<"/admin/content/collections">) {
  const viewer = await requireAnyCapability([CAPABILITIES.contentEdit, CAPABILITIES.contentPublish], "/admin/content/collections");
  const sp = await searchParams;
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("media_admin_collections");
  const rows = (data as CollectionAdmin[] | null) ?? [];
  const canPublish = viewer.capabilities.has(CAPABILITIES.contentPublish);
  const removed = typeof sp.removed === "string" && /^\d+$/.test(sp.removed) ? sp.removed : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/content" className="hover:underline">
            Teaching content
          </Link>
        }
        title="Devotional collections"
        description="Readings imported from a pinned public-domain source, one for every calendar day, repeating each year. Imports arrive as an unpublished draft for review."
        actions={
          canPublish ? (
            <ButtonLink href="/admin/content/collections/import" size="sm" icon={<Download className="size-4" aria-hidden="true" />}>
              Import Morning &amp; Evening
            </ButtonLink>
          ) : null
        }
      />
      {removed ? (
        <Alert tone="success" title="Collection removed." className="mb-6">
          {removed} readings were deleted. Members&apos; journal entries keep their text.
        </Alert>
      ) : null}
      {error ? <Alert tone="error" title="Collections couldn't be loaded. If migration 20261118000100 hasn't been applied yet, apply it first." className="mb-6" /> : null}
      {rows.length ? (
        <ul className={rowListClass}>
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/content/collections/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-muted/60">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-text">{c.title}</span>
                  <span className="block text-meta text-text-secondary">
                    {c.readings.toLocaleString("en-US")} readings · {c.edited} corrected · source {c.source.commit?.slice(0, 7) ?? "—"}
                  </span>
                </span>
                <Badge tone={STATE_BADGE[c.state].tone}>{STATE_BADGE[c.state].label}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : !error ? (
        <EmptyState glyph="devotionals" title="No collections yet">
          {canPublish ? "Import Morning & Evening to review it as a draft." : "A content publisher imports collections."}
        </EmptyState>
      ) : null}
    </>
  );
}
