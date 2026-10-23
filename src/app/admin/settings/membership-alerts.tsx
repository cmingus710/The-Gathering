import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, SectionHeading } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { AddRecipientForm, EnabledForm, RemoveRecipientList } from "./membership-alerts-forms";

type AlertAdmin = {
  enabled: boolean;
  recipients: { id: string; email: string; created_at: string }[];
  recent: {
    id: string;
    recipient_email: string;
    status: "pending" | "sending" | "sent" | "failed" | "suppressed" | "skipped";
    attempts: number;
    last_error: string | null;
    created_at: string;
    sent_at: string | null;
    updated_at: string;
    test: boolean;
  }[];
};

const STATUS: Record<AlertAdmin["recent"][number]["status"], { label: string; tone: BadgeTone }> = {
  pending: { label: "Queued", tone: "neutral" },
  sending: { label: "Sending", tone: "neutral" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  suppressed: { label: "Not sent (test)", tone: "info" },
  skipped: { label: "Skipped", tone: "info" },
};

/**
 * "Membership approval notifications" on Church settings. Shown only to
 * settings.manage holders (the page checks; the database functions check
 * again and refuse everyone else).
 */
export async function MembershipAlertsSection({ timeZone, emailAll }: { timeZone: string; emailAll: boolean }) {
  const supabase = await createClient();
  const { data, error } = supabase ? await supabase.rpc("membership_alert_admin") : { data: null, error: true };
  const admin = data as AlertAdmin | null;

  return (
    <Card>
      <SectionHeading>Membership approval notifications</SectionHeading>
      <p className="mb-6 text-text-secondary">
        Email the people listed here once when someone new confirms their email address (or signs in with a trusted provider) and is waiting for
        membership approval. The email links to the member record; reviewing still requires signing in as a membership administrator.
      </p>
      {error || !admin ? (
        <Alert tone="error" title="Notification settings couldn't be loaded">
          Try again in a moment. Nothing was changed.
        </Alert>
      ) : (
        <div className="space-y-8">
          <EnabledForm enabled={admin.enabled} recipientCount={admin.recipients.length} emailAll={emailAll} />
          <section aria-labelledby="alert-recipients-heading" className="space-y-4">
            <h3 id="alert-recipients-heading" className="text-lg font-bold">
              Recipients
            </h3>
            <RemoveRecipientList recipients={admin.recipients.map((r) => ({ id: r.id, email: r.email }))} />
            <AddRecipientForm />
          </section>
          <section aria-labelledby="alert-deliveries-heading" className="space-y-3">
            <h3 id="alert-deliveries-heading" className="text-lg font-bold">
              Recent deliveries
            </h3>
            {admin.recent.length === 0 ? (
              <p className="text-meta text-text-secondary">No notifications have been sent yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-card border border-border">
                {admin.recent.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-meta">
                    <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                    {d.test ? <Badge tone="info">Test environment</Badge> : null}
                    <span className="min-w-0 break-all font-semibold">{d.recipient_email}</span>
                    <span className="text-text-secondary">{formatDateTime(d.sent_at ?? d.updated_at, timeZone)}</span>
                    {d.attempts > 1 ? <span className="text-text-secondary">{d.attempts} attempts</span> : null}
                    {d.last_error && d.status !== "sent" ? <span className="w-full text-text-secondary">{d.status === "failed" && d.attempts >= 5 ? `Gave up: ${d.last_error}` : d.last_error}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}
