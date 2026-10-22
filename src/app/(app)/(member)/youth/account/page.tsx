import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader, SectionHeading } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { YouthForm } from "@/components/youth/youth-form";
import { requireYouthArea } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/youth/format";
import { youthRead } from "@/lib/youth/queries";

export const metadata: Metadata = { title: "My youth account" };

type Status = {
  display_name: string;
  activated_at: string | null;
  policy_version: number | null;
  current_policy_version: number | null;
  guardian_authorized: boolean;
  guardians: number;
  sharing_mode: "off" | "youth_choice";
  share_summary: boolean;
  guardian_discussion_access: "none" | "read";
  transition: { id: string; status: string } | null;
};

export default async function AccountPage() {
  const viewer = await requireYouthArea("/youth/account");
  if (viewer.accountKind !== "youth") redirect("/youth");
  const { data: s, failed } = await youthRead<Status>("youth_account_status");
  if (failed || !s) return <Alert tone="error" title="Your account details couldn't be loaded right now." />;
  return (
    <>
      <PageHeader title="My account" description="What your account is, and who can see what." />
      <div className="space-y-8">
        <Card className="space-y-2">
          <p>
            Activated {formatDay(s.activated_at)} under the church&apos;s youth policy version {s.policy_version}
            {s.current_policy_version && s.current_policy_version !== s.policy_version ? ` (the current version is ${s.current_policy_version})` : ""}.
          </p>
          <p className="text-meta text-text-secondary">
            {s.guardian_authorized ? "A verified parent or guardian authorized this account. " : ""}
            Your parent or guardian can&apos;t sign in as you or see your password.
          </p>
        </Card>
        <section aria-labelledby="who">
          <SectionHeading id="who">Who can see what</SectionHeading>
          <Card>
            <ul className="list-disc space-y-2 pl-5">
              <li>Your journal, practice answers, and reflections are only yours. Leaders and parents can&apos;t open them.</li>
              <li>Youth leaders of your groups see your name and that you&apos;re in their group.</li>
              <li>
                Group discussions are seen by the group&apos;s leaders and everyone in the group
                {s.guardian_discussion_access === "read" ? ", and by verified parents and guardians of youth in the group" : ""}. Nothing there is private.
              </li>
              <li>There are no private messages in the Youth area.</li>
            </ul>
          </Card>
        </section>
        <section aria-labelledby="sharing">
          <SectionHeading id="sharing">Sharing your progress</SectionHeading>
          <Card className="space-y-3">
            {s.sharing_mode === "youth_choice" ? (
              <>
                <div className="flex items-center gap-2">
                  <span>Right now:</span>
                  <Badge tone={s.share_summary ? "success" : "neutral"}>{s.share_summary ? "Sharing a summary" : "Not sharing"}</Badge>
                </div>
                <p className="text-meta text-text-secondary">
                  A summary means numbers only: how many verses you&apos;ve practiced, how many are ready for review, and how many days you practiced
                  recently. Never your answers, journal, or reflections. You can change this anytime.
                </p>
                <YouthForm op="sharing" hidden={{ on: s.share_summary ? "false" : "true" }} submit={s.share_summary ? "Stop sharing" : "Share a summary with my parents or guardians"} variant="secondary" inline />
              </>
            ) : (
              <p className="text-text-secondary">Progress sharing isn&apos;t offered right now, so nothing is shared.</p>
            )}
          </Card>
        </section>
        {s.transition ? (
          <section aria-labelledby="transition">
            <SectionHeading id="transition">Moving to an adult account</SectionHeading>
            <Card className="space-y-3">
              {s.transition.status === "started" ? (
                <>
                  <p>
                    The church office started moving your account to adult access. Afterwards, parents and guardians no longer see anything about your
                    account, you leave youth groups, and your learning history stays with you. Direct messaging still needs the church office&apos;s
                    approval.
                  </p>
                  <YouthForm op="transition_confirm" hidden={{ id: s.transition.id }} submit="Confirm">
                    <TextField label='Type "this is my account" to confirm' name="confirm" autoComplete="off" required />
                  </YouthForm>
                </>
              ) : (
                <p>You confirmed. The church office will complete the change.</p>
              )}
            </Card>
          </section>
        ) : null}
      </div>
    </>
  );
}
