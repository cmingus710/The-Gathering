import { Lock, MessageCircle } from "lucide-react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeading } from "@/components/ui/card";
import { exactTime } from "@/lib/community/format";
import { REPORT_REASONS, type ReportDetail } from "@/lib/community/types";
import { CommunityText } from "./community-text";
import { PostModeration, ThreadModeration } from "./moderation-controls";
import { LiftRestriction, ResolveReportForm, RestrictForm } from "./report-review";

const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.value === r)?.label ?? r;

/**
 * One report: the reporter's reason, ONLY the reported items as captured at
 * report time, the item's current state, and actions in the reviewer's
 * scope. Opening this page is recorded in the moderation log.
 */
export function ReportDetailView({ report, tz }: { report: ReportDetail; tz: string }) {
  const closed = report.status === "actioned" || report.status === "dismissed";
  return (
    <div className="space-y-8">
      <Card className="space-y-2">
        <p className="flex flex-wrap gap-2">
          <Badge tone={closed ? "neutral" : "warning"}>{report.status === "reviewing" ? "In review" : report.status === "open" ? "Open" : report.status === "actioned" ? "Closed: action taken" : "Closed: no action"}</Badge>
          <Badge tone="info">{report.is_message ? "Direct message" : report.group_name ? `Group: ${report.group_name}` : "Church-wide"}</Badge>
          {report.involves_group_leader ? <Badge tone="danger">About a group leader</Badge> : null}
        </p>
        <p>
          <span className="font-semibold">{reasonLabel(report.reason)}</span> · reported by {report.reporter} about {report.reported} ·{" "}
          <time dateTime={report.created_at}>{exactTime(report.created_at, tz)}</time>
        </p>
        {report.details ? <p className="text-text-secondary">&ldquo;{report.details}&rdquo;</p> : null}
        {report.resolution ? (
          <p className="text-[0.95rem]">
            <span className="font-semibold">Resolution:</span> {report.resolution} ({report.resolved_by}, {report.resolved_at ? exactTime(report.resolved_at, tz) : ""})
          </p>
        ) : null}
      </Card>

      <section aria-labelledby="evidence-heading">
        <SectionHeading id="evidence-heading">Reported {report.is_message ? "messages" : "content"} (as captured)</SectionHeading>
        {report.evidence ? (
          <ol className="space-y-3">
            {report.evidence.map((e) => (
              <li key={e.id}>
                <Card className="space-y-2">
                  <p className="text-sm text-text-secondary">
                    {e.type === "message" ? (
                      <>
                        <MessageCircle className="mr-1 inline size-3.5" aria-hidden="true" />
                        From the {e.from === "reported" ? "reported member" : "reporter"}
                      </>
                    ) : (
                      <>
                        {e.type === "thread" ? "Discussion" : `Reply in “${e.thread_title}”`} by {e.author}
                      </>
                    )}{" "}
                    · <time dateTime={e.created_at}>{exactTime(e.created_at, tz)}</time>
                    {e.edited_at ? " · edited before it was reported" : ""}
                  </p>
                  {e.title ? <p className="font-semibold">{e.title}</p> : null}
                  {e.type === "message" ? <p className="whitespace-pre-wrap break-words">{e.body}</p> : <CommunityText source={e.body} />}
                </Card>
              </li>
            ))}
          </ol>
        ) : (
          <Alert tone="info" title="The captured evidence was cleared under the retention policy." />
        )}
        {report.is_message ? (
          <p className="mt-3 flex items-center gap-2 text-[0.95rem] text-text-secondary">
            <Lock className="size-4" aria-hidden="true" /> Only the selected messages are shown. The rest of the conversation stays private.
          </p>
        ) : null}
      </section>

      {!report.is_message && report.current && report.thread_id ? (
        <section aria-labelledby="actions-heading">
          <SectionHeading id="actions-heading">Content actions</SectionHeading>
          <Card className="space-y-3">
            <p className="text-[0.95rem]">
              Current state: <strong>{report.current.status}</strong>
              {report.current.locked ? " · locked" : ""}.{" "}
              {report.current.status === "visible" || report.current.status === "hidden" ? (
                <Link href={`/community/t/${report.thread_id}`} className="font-semibold text-primary underline">
                  Open the discussion
                </Link>
              ) : null}
            </p>
            {report.target_type === "thread" ? (
              <ThreadModeration
                threadId={report.target_ids[0]}
                pinned={!!report.current.pinned}
                locked={!!report.current.locked}
                status={report.current.status}
                reportId={report.id}
              />
            ) : (
              <PostModeration postId={report.target_ids[0]} threadId={report.thread_id} status={report.current.status} reportId={report.id} />
            )}
          </Card>
        </section>
      ) : null}

      {report.can_restrict && report.reported_id ? (
        <section aria-labelledby="restrict-heading">
          <SectionHeading id="restrict-heading">Community restriction</SectionHeading>
          <Card>
            {report.active_restriction ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>
                  {report.reported} is restricted ({report.active_restriction.scope})
                  {report.active_restriction.ends_at ? ` until ${exactTime(report.active_restriction.ends_at, tz)}` : " until lifted"}.
                </p>
                <LiftRestriction restrictionId={report.active_restriction.id} name={report.reported} />
              </div>
            ) : (
              <RestrictForm profileId={report.reported_id} name={report.reported} reportId={report.id} />
            )}
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="resolve-heading">
        <SectionHeading id="resolve-heading">Outcome</SectionHeading>
        <Card>
          <ResolveReportForm reportId={report.id} closed={closed} />
        </Card>
      </section>

      <section aria-labelledby="log-heading">
        <SectionHeading id="log-heading">Activity on this report</SectionHeading>
        <ul className="space-y-1 text-[0.95rem]">
          {report.log.map((l, i) => (
            <li key={i}>
              <time dateTime={l.at}>{exactTime(l.at, tz)}</time> · {l.actor} · {l.action}
              {l.reason ? ` · ${l.reason}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
