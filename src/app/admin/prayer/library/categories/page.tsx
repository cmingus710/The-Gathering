import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AddCategoryForm, CategoryRow } from "@/components/prayer/library-category-forms";
import { Alert } from "@/components/ui/alert";
import { PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { KIND_PLURAL, KINDS, type AdminCategory, type CategoryKind } from "@/lib/prayer/library";

export const metadata: Metadata = { title: "Prayer Library categories" };

const ABOUT: Record<CategoryKind, string> = {
  topic: "What a prayer is about. Members can choose several.",
  purpose: "What kind of prayer it is, such as gratitude or confession.",
  use: "Where a prayer fits, such as meals or opening a gathering.",
};

/** Church settings managers: the topics, purposes, and uses members choose from. No prayer content is reachable here. */
export default async function LibraryCategoriesPage() {
  await requireCapability(CAPABILITIES.settingsManage, "/admin/prayer/library/categories");
  const categories = await tryCommunityRpc<AdminCategory[]>("prayer_library_admin_categories");
  return (
    <>
      <Link href="/admin/prayer/library" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer Library moderation
      </Link>
      <PageHeader
        title="Topics, purposes, and uses"
        description="The labels members choose when they add a prayer, and filter by in the library. Archiving one removes it from forms and filters; prayers that have it keep the label. Changes are recorded in the audit log."
      />
      {!categories ? (
        <Alert tone="error" title="Categories couldn't be loaded." />
      ) : (
        <div className="max-w-3xl space-y-10">
          {KINDS.map((kind) => {
            const list = categories.filter((c) => c.kind === kind);
            return (
              <section key={kind} aria-labelledby={`kind-${kind}`} className="space-y-3">
                <SectionHeading id={`kind-${kind}`} description={ABOUT[kind]}>
                  {KIND_PLURAL[kind]}
                </SectionHeading>
                {list.length ? (
                  <ul className="divide-y divide-border rounded-card border border-border bg-surface">
                    {list.map((c) => (
                      <li key={c.id}>
                        <CategoryRow category={c} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-text-secondary">None yet.</p>
                )}
                <AddCategoryForm kind={kind} />
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
