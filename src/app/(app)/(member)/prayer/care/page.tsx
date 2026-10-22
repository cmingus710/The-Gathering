import { ArrowLeft, ChevronRight, HandHelping } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, ListRow, PageHeader, rowListClass } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { CARE_KIND_LABEL, CARE_STATUS_LABEL } from "@/lib/prayer/format";
import type { MyCareRow } from "@/lib/prayer/types";

export const metadata: Metadata = { title: "My care requests" };

export default async function MyCarePage() {
  await requireApprovedMember("/prayer/care");
  const rows = await tryCommunityRpc<MyCareRow[]>("care_my_requests");
  return (
    <>
      <Link href="/prayer" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> Prayer
      </Link>
      <PageHeader
        title="My care requests"
        description="Practical help from the care team. Only you and the care team can see these."
        actions={
          <ButtonLink href="/prayer/care/new" icon={<HandHelping className="size-4" aria-hidden="true" />}>
            Request help
          </ButtonLink>
        }
      />
      {!rows ? (
        <Alert tone="error" title="Your care requests couldn't be loaded right now." />
      ) : rows.length ? (
        <ul className={rowListClass}>
          {rows.map((r) => (
            <li key={r.id}>
              <ListRow
                plain
                href={`/prayer/care/${r.id}`}
                icon={<HandHelping className="size-5" aria-hidden="true" />}
                label={r.summary}
                description={`${CARE_KIND_LABEL[r.kind]} · ${CARE_STATUS_LABEL[r.status]}${r.has_coordinator ? " · coordinator assigned" : ""}`}
                trailing={
                  <span className="flex items-center gap-1">
                    {relativeTime(r.updated_at)}
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState glyph="prayer" title="No care requests" action={<ButtonLink href="/prayer/care/new" variant="secondary" size="sm">Request help</ButtonLink>}>
          Need a meal, a ride, or a visit? Let the care team know.
        </EmptyState>
      )}
    </>
  );
}
