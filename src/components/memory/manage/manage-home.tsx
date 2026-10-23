import { ChevronRight, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, ListRow, PageHeader, SectionHeading, rowListClass } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { authorizeGroupAction } from "@/lib/memory/manage-actions";
import { audienceLabel, collectionStatus, formatDay } from "@/lib/memory/format";
import type { Challenge } from "@/lib/memory/types";
import type { AdminHome, ManageBase } from "./types";

/**
 * Overview for memory verse managers. Staff see church and group
 * collections (never anyone's personal collection or results); authorized
 * group leaders see only their groups' collections and challenges.
 */
export function ManageHome({ data, challenges, base }: { data: AdminHome; challenges: Challenge[]; base: ManageBase }) {
  const leader = base === "/memory/lead";
  return (
    <>
      <PageHeader
        title={leader ? "My group's memory verses" : "Memory verses"}
        description={
          leader
            ? `Collections and challenges for ${data.led_groups.map((g) => g.name).join(", ") || "your groups"}. You can't see anyone's practice results.`
            : "Collections, weekly and multiweek assignments, and group challenges. Nobody's practice results are visible here."
        }
        actions={
          <>
            <ButtonLink href={`${base}/collections/new`} size="sm" icon={<Plus className="size-4" aria-hidden="true" />}>
              New collection
            </ButtonLink>
            {data.can_publish || leader ? (
              <ButtonLink href={`${base}/challenges/new`} size="sm" variant="secondary">
                New group challenge
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="space-y-8">
        {!data.translations.some((t) => t.memory_eligible) ? (
          <EmptyState glyph="memory" title="No Bible version is available for memory verses">
            Memory practice needs a published translation whose text is stored here, or a licensed one whose terms a Bible source manager has confirmed for
            memory verses (Administration → Bible sources).
          </EmptyState>
        ) : null}
        <section aria-labelledby="cols">
          <SectionHeading id="cols">Collections</SectionHeading>
          {data.collections.length ? (
            <ul className={rowListClass}>
              {data.collections.map((c) => {
                const st = collectionStatus(c);
                return (
                  <li key={c.id}>
                    <ListRow
                      plain
                      href={`${base}/collections/${c.id}`}
                      label={c.title}
                      description={[audienceLabel(c), c.kind === "sequence" ? "Multiweek sequence" : null, `${c.item_count} verses`, c.translation.code, c.scheduled && c.publish_at ? `from ${formatDay(c.publish_at.slice(0, 10))}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                      trailing={
                        <span className="flex items-center gap-2">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <ChevronRight className="size-5" aria-hidden="true" />
                        </span>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-text-secondary">No collections yet.</p>
          )}
        </section>

        <section aria-labelledby="challenges">
          <SectionHeading id="challenges" description="Optional group challenges show members only a shared total, and only once enough people share.">
            Group challenges
          </SectionHeading>
          {challenges.length ? (
            <ul className={rowListClass}>
              {challenges.map((ch) => (
                <li key={ch.id}>
                  <ListRow
                    plain
                    href={`${base}/challenges/${ch.id}`}
                    label={ch.title}
                    description={`${ch.group?.name ?? ""} · ${formatDay(ch.starts_on)} – ${formatDay(ch.ends_on)}`}
                    trailing={<Badge tone={ch.status === "active" ? "success" : "neutral"}>{ch.status === "active" ? "Active" : ch.status === "ended" ? "Ended" : "Canceled"}</Badge>}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-secondary">No challenges yet.</p>
          )}
        </section>

        {!leader && data.can_publish ? (
          <section aria-labelledby="leaders">
            <SectionHeading
              id="leaders"
              description="An authorized group's active leaders can create and publish collections and challenges for that group only. It gives them no other access: not membership, giving, care, journals, or anyone's practice results."
            >
              Group leaders
            </SectionHeading>
            <Card className="p-0 sm:p-0">
              <ul className="divide-y divide-border">
                {data.groups.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span>
                      <span className="font-semibold">{g.name}</span>
                      <span className="text-meta text-text-secondary"> · {g.visibility === "hidden" ? "hidden group" : "discoverable"}</span>
                    </span>
                    <form action={authorizeGroupAction} className="flex items-center gap-2">
                      <input type="hidden" name="group_id" value={g.id} />
                      <input type="hidden" name="on" value={g.authorized ? "0" : "1"} />
                      {g.authorized ? <Badge tone="success">Leaders authorized</Badge> : null}
                      <SubmitButton size="sm" variant={g.authorized ? "ghost" : "secondary"}>
                        {g.authorized ? "Revoke" : "Authorize leaders"}
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
