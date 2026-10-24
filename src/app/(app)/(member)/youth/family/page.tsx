import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, SectionHeading } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { StateBadge } from "@/components/youth/state-badge";
import { YouthForm } from "@/components/youth/youth-form";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { RELATIONSHIPS, REQUEST_STATUS, formatDay } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";
import type { FamilyChild } from "@/lib/youth/types";

export const metadata: Metadata = { title: "Family dashboard" };

type Family = {
  children: FamilyChild[];
  paused: number;
  requests: Array<{ id: string; kind: string; child_name: string; relationship: string; status: string; created_at: string; decided_at: string | null }>;
};

export default async function FamilyPage({ searchParams }: PageProps<"/youth/family">) {
  await requireApprovedMember("/youth/family");
  const sp = await searchParams;
  const { data, failed } = await youthRead<Family>("youth_family");
  return (
    <>
      <BackLink route="/youth/family" />
      <SectionHeader section="youth" size="compact"
        title="Family dashboard"
        description="Children you're a verified guardian for, what's coming up, and anything waiting on you."
        actions={<ButtonLink href="/youth/family/request" variant="secondary">Link a child</ButtonLink>}
      />
      {sp.sent ? (
        <Alert tone="success" title="Request sent." className="mb-6">
          The church office reviews every request with you directly. Nothing is shared until it&apos;s verified.
        </Alert>
      ) : null}
      {failed || !data ? (
        <Alert tone="error" title="Your family dashboard couldn't be loaded right now." />
      ) : (
        <div className="space-y-10">
          {data.paused > 0 ? (
            <Alert tone="info" title={`Access to ${data.paused} ${data.paused === 1 ? "child is" : "children are"} paused.`}>
              The church office paused this while something is reviewed. Please contact the office with any questions.
            </Alert>
          ) : null}
          <section aria-labelledby="kids">
            <SectionHeading id="kids">Your children</SectionHeading>
            {data.children.length === 0 ? (
              <EmptyState glyph="youth" title="No linked children yet">
                Ask to be linked to your child. The church office verifies each parent or guardian in person; sharing a household isn&apos;t enough.
              </EmptyState>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {data.children.map((c) => (
                  <li key={c.id}>
                    <Card className="flex h-full flex-col gap-3">
                      <div>
                        <h3 className="text-[1.25rem] font-semibold">{c.display_name}</h3>
                        <p className="text-meta text-text-secondary">
                          {RELATIONSHIPS[c.relationship] ?? c.relationship}
                          {c.groups.length ? ` · ${c.groups.map((g) => g.name).join(", ")}` : " · Not in a youth group yet"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {c.outstanding_forms > 0 ? <Badge tone="warning">{c.outstanding_forms} form{c.outstanding_forms === 1 ? "" : "s"} to review</Badge> : <Badge tone="success">No forms waiting</Badge>}
                        {c.upcoming > 0 ? <Badge tone="neutral">{c.upcoming} upcoming</Badge> : null}
                        {c.participation === "paused" ? <Badge tone="neutral">Participation paused</Badge> : null}
                        {c.account_linked ? <Badge tone="info">Has their own account</Badge> : null}
                      </div>
                      <div className="mt-auto flex flex-wrap gap-2">
                        <ButtonLink href={`/youth/family/children/${c.id}`} size="sm">
                          Open
                        </ButtonLink>
                        {c.permissions.practice && !c.account_linked ? (
                          <ButtonLink href={`/youth/family/children/${c.id}/practice`} size="sm" variant="secondary">
                            Practice verses together
                          </ButtonLink>
                        ) : null}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="requests">
            <SectionHeading id="requests">Your requests</SectionHeading>
            {data.requests.length === 0 ? (
              <p className="text-meta text-text-secondary">No requests.</p>
            ) : (
              <ul className="space-y-2">
                {data.requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-border bg-surface px-4 py-3">
                    <div>
                      <p className="font-semibold">{r.child_name}</p>
                      <p className="text-meta text-text-secondary">
                        {RELATIONSHIPS[r.relationship]} · sent {formatDay(r.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StateBadge map={REQUEST_STATUS} value={r.status} />
                      {r.status === "pending" ? (
                        <YouthForm op="request_withdraw" hidden={{ id: r.id }} submit="Withdraw" variant="secondary" size="sm" inline pendingText="Withdrawing…" />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-meta text-text-secondary">
              &quot;Reviewed&quot; means the church office has finished with a request. If you were linked, your child appears above.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
