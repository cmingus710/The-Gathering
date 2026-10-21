import { Badge } from "@/components/ui/badge";
import { Card, EmptyState } from "@/components/ui/card";
import { CheckboxField } from "@/components/ui/field";
import { REPORT_REASONS, formatWhen } from "@/lib/youth/format";
import { YouthForm } from "./youth-form";

export type YouthReport = {
  id: string;
  discussion_id: string;
  post_id: string | null;
  reason: string;
  note: string;
  about_leader: boolean;
  status: string;
  created_at: string;
  evidence: { discussion_title?: string; group?: string; body?: string | null; author?: string; posted_at?: string } | null;
  post_status: string | null;
};

/** Reports the reviewer may handle. Reports about a leader reach only safeguarding reviewers outside that leader's groups. */
export function ReportList({ reports }: { reports: YouthReport[] }) {
  if (reports.length === 0) return <EmptyState glyph="community" title="No open reports" />;
  return (
    <ul className="space-y-4">
      {reports.map((r) => (
        <li key={r.id}>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">{REPORT_REASONS[r.reason] ?? r.reason}</Badge>
              {r.about_leader ? <Badge tone="danger">About a leader</Badge> : null}
              <span className="text-meta text-text-secondary">{formatWhen(r.created_at)}</span>
            </div>
            {r.evidence ? (
              <div className="rounded-tile border border-border px-4 py-3">
                <p className="text-meta text-text-secondary">
                  {r.evidence.group} · “{r.evidence.discussion_title}” · {r.evidence.author}
                </p>
                {r.evidence.body ? <p className="mt-1 whitespace-pre-wrap break-words">{r.evidence.body}</p> : <p className="mt-1 text-meta">The discussion itself was reported.</p>}
              </div>
            ) : null}
            {r.note ? <p className="text-meta">Reporter&apos;s note: {r.note}</p> : null}
            <p className="text-meta text-text-secondary">The reporter&apos;s identity isn&apos;t shown. Viewing reports is recorded (without their content).</p>
            {r.status === "open" ? (
              <div className="flex flex-wrap gap-3">
                <YouthForm op="report_resolve" hidden={{ id: r.id, outcome: "actioned" }} submit="Resolve (action taken)" size="sm" className="space-y-2">
                  <CheckboxField id={`hide-${r.id}`} name="hide" label="Hide the reported content" defaultChecked />
                </YouthForm>
                <YouthForm op="report_resolve" hidden={{ id: r.id, outcome: "dismissed" }} submit="Dismiss" size="sm" variant="secondary" inline />
              </div>
            ) : null}
            <a href={`/youth/discussions/${r.discussion_id}`} className="text-meta font-semibold text-primary hover:underline">
              Open the discussion
            </a>
          </Card>
        </li>
      ))}
    </ul>
  );
}
