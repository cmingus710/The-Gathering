import { ArrowLeft, ChevronRight, MessagesSquare, PenSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudienceNotice } from "@/components/community/composer";
import { ThreadRow } from "@/components/community/thread-row";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { communityRpc, tryCommunityRpc } from "@/lib/community/queries";
import type { Category, ThreadPage } from "@/lib/community/types";

export const metadata: Metadata = { title: "Discussions" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function CategoryPage({ params, searchParams }: PageProps<"/community/c/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/community/c/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const at = typeof sp.at === "string" && !Number.isNaN(Date.parse(sp.at)) ? sp.at : null;
  const after = typeof sp.after === "string" && UUID.test(sp.after) ? sp.after : null;
  const categories = (await tryCommunityRpc<Category[]>("community_categories")) ?? [];
  const category = categories.find((c) => c.id === id);
  if (!category) notFound();

  let page: ThreadPage | null = null;
  try {
    page = await communityRpc<ThreadPage>("community_threads", { p_category: id, p_cursor_at: at && after ? at : null, p_cursor_id: at && after ? after : null, p_limit: 20 });
  } catch {
    page = null;
  }
  const all = page ? [...page.pinned, ...page.items] : [];

  return (
    <>
      <Link href="/community" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Community
      </Link>
      <PageHeader
        title={category.name}
        description={category.description || undefined}
        actions={
          <ButtonLink href={`/community/new?category=${id}`} icon={<PenSquare className="size-4" aria-hidden="true" />}>
            New discussion
          </ButtonLink>
        }
      />
      <div className="mb-6">
        <AudienceNotice audience="church" place={category.name} />
      </div>
      {!page ? (
        <Alert tone="error" title="These discussions couldn't be loaded right now.">
          Please try again in a moment.
        </Alert>
      ) : !all.length ? (
        <EmptyState
          icon={<MessagesSquare className="size-6" aria-hidden="true" />}
          title={at ? "No older discussions" : "No discussions here yet"}
          action={
            <ButtonLink href={at ? `/community/c/${id}` : `/community/new?category=${id}`} variant="secondary" size="sm">
              {at ? "Back to newest" : "Start one"}
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ul className="space-y-2" aria-label={`Discussions in ${category.name}`}>
            {all.map((t) => (
              <li key={t.id}>
                <ThreadRow thread={t} />
              </li>
            ))}
          </ul>
          <nav aria-label="More discussions" className="mt-6 flex flex-wrap justify-between gap-3">
            {at ? (
              <ButtonLink href={`/community/c/${id}`} variant="secondary" size="sm">
                Newest
              </ButtonLink>
            ) : (
              <span />
            )}
            {page.next_cursor ? (
              <ButtonLink
                href={`/community/c/${id}?at=${encodeURIComponent(page.next_cursor.at)}&after=${page.next_cursor.id}`}
                variant="secondary"
                size="sm"
              >
                Older discussions <ChevronRight className="size-4" aria-hidden="true" />
              </ButtonLink>
            ) : null}
          </nav>
        </>
      )}
    </>
  );
}
