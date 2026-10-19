import { UsersRound } from "lucide-react";
import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireCapability } from "@/lib/auth/viewer";
import { tryCommunityRpc } from "@/lib/community/queries";
import { CategoryRow, CommunitySettingsForm, GuidelinesForm } from "./community-forms";

export const metadata: Metadata = { title: "Community settings" };

type AdminSettings = {
  guidelines: string;
  guidelines_version: number;
  digest_hour: number;
  weekly_digest_dow: number;
  dm_retention_days: number;
  report_evidence_days: number;
  acknowledged: number;
  categories: Array<{ id: string; name: string; description: string; active: boolean; sort_order: number; threads: number }>;
};

export default async function CommunityAdminPage() {
  await requireCapability(CAPABILITIES.communityManage, "/admin/community");
  const s = await tryCommunityRpc<AdminSettings>("community_admin_settings");
  return (
    <>
      <PageHeader
        title="Community"
        description="Discussion categories, community guidelines, digests, and retention. Community administrators can't read private group discussions or messages."
        actions={
          <ButtonLink href="/admin/community/groups" variant="secondary" size="sm" icon={<UsersRound className="size-4" aria-hidden="true" />}>
            Groups
          </ButtonLink>
        }
      />
      {!s ? (
        <Alert tone="error" title="Community settings couldn't be loaded." />
      ) : (
        <div className="space-y-10">
          <section aria-labelledby="categories-heading">
            <SectionHeading id="categories-heading">Discussion categories</SectionHeading>
            <Card>
              <div className="divide-y divide-border">
                {s.categories.map((c, i) => (
                  <CategoryRow key={c.id} category={c} first={i === 0} last={i === s.categories.length - 1} />
                ))}
                <CategoryRow />
              </div>
            </Card>
          </section>
          <section aria-labelledby="guidelines-heading">
            <SectionHeading id="guidelines-heading">Community guidelines</SectionHeading>
            <Card>
              <GuidelinesForm text={s.guidelines} version={s.guidelines_version} acknowledged={s.acknowledged} />
            </Card>
          </section>
          <section aria-labelledby="settings-heading">
            <SectionHeading id="settings-heading">Digests and retention</SectionHeading>
            <Card>
              <CommunitySettingsForm s={s} />
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
