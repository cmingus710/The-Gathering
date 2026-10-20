import { Card, SectionHeading } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { challengeStatusAction } from "@/lib/memory/manage-actions";
import { formatDay } from "@/lib/memory/format";
import type { Challenge } from "@/lib/memory/types";
import { ActionForm } from "./action-form";
import { ChallengeForm } from "./challenge-form";
import type { ManageBase } from "./types";

/** Organizers see the same shared total as members: never people or results. */
export function ChallengeView({ base, challenge: ch }: { base: ManageBase; challenge: Challenge }) {
  const a = ch.aggregate;
  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading id="total">Shared total</SectionHeading>
        {a.visible ? (
          <p>
            {a.sessions} of {a.goal} practice activities ({a.percent}%) · {a.participants} people sharing · rounded down to 5, through {a.through ? formatDay(a.through) : "yesterday"}
          </p>
        ) : (
          <p className="text-text-secondary">Hidden until at least {a.min_participants} people share. Organizers never see who joined or anyone&apos;s practice.</p>
        )}
        <p className="mt-2 text-meta text-text-secondary">
          {formatDay(ch.starts_on)} – {formatDay(ch.ends_on)} · {ch.collection?.title} · {ch.status}
        </p>
      </Card>
      {ch.status === "active" ? (
        <>
          <Card>
            <ChallengeForm base={base} challenge={ch} groups={[]} collections={[]} today={ch.starts_on} />
          </Card>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={challengeStatusAction} hidden={{ base, id: ch.id, op: "end" }}>
              <SubmitButton variant="secondary">End now</SubmitButton>
            </ActionForm>
            <ActionForm action={challengeStatusAction} hidden={{ base, id: ch.id, op: "cancel" }}>
              <SubmitButton variant="danger-outline">Cancel challenge</SubmitButton>
            </ActionForm>
          </div>
        </>
      ) : null}
    </div>
  );
}
