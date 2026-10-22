import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/card";
import { requireLearner } from "@/lib/auth/viewer";
import type { Translation } from "@/lib/bible/types";
import { requireClient } from "@/lib/supabase/server";
import { MyCollectionForm } from "../forms";

export const metadata: Metadata = { title: "New collection" };

export default async function NewCollectionPage() {
  await requireLearner("/memory/collections/new");
  const supabase = await requireClient();
  const { data } = await supabase.rpc("bible_translations");
  const t = (data as { default_id: string | null; preferred_id: string | null; items: Translation[] } | null) ?? { default_id: null, preferred_id: null, items: [] };
  const stored = t.items.filter((x) => x.source_kind === "database");
  return (
    <>
      <Link href="/memory/collections" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Collections
      </Link>
      <PageHeader title="New collection" description="A private collection for your own verses. One Bible version per collection, so versions are never mixed." />
      <Card>
        <MyCollectionForm translations={stored.map((x) => ({ id: x.id, label: `${x.name} (${x.code})` }))} defaultTranslation={t.preferred_id ?? t.default_id ?? stored[0]?.id ?? ""} />
      </Card>
    </>
  );
}
