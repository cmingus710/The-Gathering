import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LibraryComposer } from "@/components/prayer/library-composer";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/card";
import { displayName, requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import type { LibraryMeta, LibraryPrayer } from "@/lib/prayer/library";

export const metadata: Metadata = { title: "Edit prayer" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function EditLibraryPrayerPage({ params }: PageProps<"/prayer/library/[id]/edit">) {
  const { id } = await params;
  const viewer = await requireApprovedMember(`/prayer/library/${id}/edit`);
  if (!UUID.test(id)) notFound();
  const [p, meta] = await Promise.all([tryCommunityRpc<LibraryPrayer>("prayer_library_prayer", { p_id: id }), tryCommunityRpc<LibraryMeta>("prayer_library_meta")]);
  // Only the contributor edits; everyone else gets "not found".
  if (!p || !p.mine) notFound();
  return (
    <>
      <BackLink route="/prayer/library/[id]/edit" params={{ id }} />
      <PageHeader title="Edit prayer" description={p.status === "published" ? "Changes appear in the library as soon as you save. It keeps its original publication date." : "Save it as a draft, or publish it when you're ready."} />
      {!meta ? (
        <Alert tone="error" title="The Prayer Library is unavailable right now." />
      ) : p.status === "archived" || !p.can_edit ? (
        <Alert tone="info" title="Restore this prayer from the archive before editing it." />
      ) : (
        <LibraryComposer
          categories={meta.categories}
          contributor={displayName(viewer)}
          postingRestricted={meta.posting_restricted}
          initial={{
            id: p.id,
            status: p.status,
            title: p.title,
            body: p.body,
            origin: p.origin,
            sourceName: p.source_name ?? "",
            sourceUrl: p.source_url ?? "",
            scripture: p.scripture_refs,
            categories: p.categories.map((c) => c.id),
          }}
        />
      )}
    </>
  );
}
