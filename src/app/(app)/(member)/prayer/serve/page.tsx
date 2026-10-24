import { ChevronRight, HandHeart } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState, ListRow, rowListClass } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { SIGNUP_LABEL } from "@/lib/prayer/format";
import type { OpportunityCard } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Ways to help" };


export default async function ServePage() {
  await requireApprovedMember("/prayer/serve");
  const [rows, { settings }] = await Promise.all([tryCommunityRpc<OpportunityCard[]>("care_opportunities"), getChurchSettings()]);
  return (
    <>
      <BackLink route="/prayer/serve" />
      <SectionHeader section="prayer" size="compact" title="Ways to help" description="Practical care needs the care team has asked for help with. Details are shared only with the volunteers they confirm." />
      {!rows ? (
        <Alert tone="error" title="Opportunities couldn't be loaded right now." />
      ) : rows.length ? (
        <ul className={rowListClass}>
          {rows.map((o) => (
            <li key={o.id}>
              <ListRow
                plain
                href={`/prayer/serve/${o.id}`}
                icon={<HandHeart className="size-5" aria-hidden="true" />}
                label={o.title}
                description={`${formatDateTime(o.starts_at, settings.timezone)} · ${o.accepted_count} of ${o.helpers_needed} helpers`}
                trailing={
                  <span className="flex items-center gap-1">
                    {o.my_status ? SIGNUP_LABEL[o.my_status] : o.status === "open" ? "Open" : null}
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState glyph="groups" title="No open opportunities right now">
          When the care team needs helpers, opportunities will appear here.
        </EmptyState>
      )}
    </>
  );
}
