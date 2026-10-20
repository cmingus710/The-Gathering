import { ArrowLeft, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/community/live-refresh";
import { ToggleForm } from "@/components/community/toggle-form";
import { CareMessageForm } from "@/components/prayer/care-forms";
import { DialogAction } from "@/components/prayer/controls";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { exactTime, relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import { CARE_KIND_LABEL, CARE_STATUS_LABEL, CARE_STATUSES, CLOSED_REASON_LABEL, CONTACT_LABEL, dateRange, OPPORTUNITY_STATUS_LABEL } from "@/lib/prayer/format";
import type { MyCareRequest } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { consentAction, withdrawCareAction } from "../../care-actions";

export const metadata: Metadata = { title: "Care request" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function CareRequestPage({ params, searchParams }: PageProps<"/prayer/care/[id]">) {
  const { id } = await params;
  await requireApprovedMember(`/prayer/care/${id}`);
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const [c, { settings }] = await Promise.all([tryCommunityRpc<MyCareRequest>("care_request", { p_id: id }), getChurchSettings()]);
  if (!c) notFound();
  const tz = settings.timezone;
  const step = CARE_STATUSES.indexOf(c.status);
  const when = dateRange(c.needed_on, c.needed_until);
  return (
    <>
      <LiveRefresh />
      <Link href="/prayer/care" className="mb-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> My care requests
      </Link>
      {sp.sent ? <Alert tone="success" title="Your request was sent privately to the care team." className="mb-4" /> : null}
      <header className="mb-6">
        <p className="mb-1 text-meta font-semibold text-primary">{CARE_KIND_LABEL[c.kind]} · Private to you and the care team</p>
        <h1 className="font-display text-[1.75rem] font-semibold leading-tight">{c.summary}</h1>
        <p className="mt-1 text-meta text-text-secondary">
          Sent <time dateTime={c.created_at} title={exactTime(c.created_at, tz)}>{relativeTime(c.created_at)}</time>
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">Status</h2>
            <ol className="flex flex-wrap gap-2" aria-label="Request progress">
              {CARE_STATUSES.map((s, i) => (
                <li key={s} aria-current={s === c.status ? "step" : undefined} className={`rounded-full border px-3 py-1 text-meta font-semibold ${s === c.status ? "border-primary bg-primary-soft text-text" : i < step ? "border-border text-text" : "border-border text-text-secondary"}`}>
                  {CARE_STATUS_LABEL[s]}
                </li>
              ))}
            </ol>
            {c.status === "closed" && c.closed_reason ? <p className="mt-3 text-meta text-text-secondary">{CLOSED_REASON_LABEL[c.closed_reason] ?? "Closed"}</p> : null}
            <p className="mt-3 text-meta">{c.coordinator ? <>Your coordinator is <strong>{c.coordinator}</strong>.</> : "A coordinator will be assigned soon."}</p>
          </Card>

          <section aria-labelledby="messages-heading" className="space-y-3">
            <h2 id="messages-heading" className="font-semibold">
              Messages with the care team
            </h2>
            <p className="text-meta text-text-secondary">You and the care team can both read these. The team&apos;s internal notes are kept separately and aren&apos;t shown here.</p>
            {c.messages.length ? (
              <ol className="space-y-3">
                {c.messages.map((m) => (
                  <li key={m.id} className={`rounded-card border p-4 ${m.from_team ? "border-primary/40 bg-primary-soft" : "border-border bg-surface"}`}>
                    <p className="mb-1 text-meta">
                      <span className="font-semibold">{m.from_team ? `${m.author} (care team)` : "You"}</span> ·{" "}
                      <time dateTime={m.created_at} className="text-text-secondary">{relativeTime(m.created_at)}</time>
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-text-secondary">No messages yet.</p>
            )}
            {c.status !== "closed" ? (
              <Card>
                <CareMessageForm careId={c.id} label="Message the care team" hint="Plain text. Please don't include medical records or ID numbers." />
              </Card>
            ) : null}
          </section>
        </div>

        <aside className="space-y-4">
          <Card className="space-y-2 text-meta">
            <h2 className="text-base font-semibold">Details you shared</h2>
            {when ? <p><strong>When:</strong> {when}</p> : null}
            <p><strong>Contact:</strong> {CONTACT_LABEL[c.contact_method]}</p>
            {c.contact_note ? <p><strong>Notes:</strong> {c.contact_note}</p> : null}
            {c.details ? <p className="whitespace-pre-wrap">{c.details}</p> : null}
          </Card>
          <Card className="space-y-3 text-meta">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Users className="size-4" aria-hidden="true" /> Volunteers</h2>
            <p>
              {c.share_consent
                ? "Accepted volunteers may see your first name and the details the care team shares (such as a drop-off address)."
                : "Volunteers see only a general task and time, never your name or address."}
            </p>
            {c.status !== "closed" ? (
              <ToggleForm
                action={consentAction}
                hidden={{ careId: c.id, on: String(!c.share_consent) }}
                label={c.share_consent ? "Stop sharing with volunteers" : "Allow sharing with volunteers"}
                pressed={c.share_consent}
                description={c.share_consent ? "Hide your name and logistics from volunteers" : "Let accepted volunteers see your first name and logistics"}
              />
            ) : null}
            {c.opportunities.length ? (
              <ul className="space-y-1">
                {c.opportunities.map((o) => (
                  <li key={o.id}>
                    {o.title}: {OPPORTUNITY_STATUS_LABEL[o.status]} ({o.accepted_count} of {o.helpers_needed} helpers)
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          {c.status !== "closed" ? (
            <DialogAction action={withdrawCareAction} hidden={{ careId: c.id }} trigger="Withdraw request" variant="danger-outline" confirmVariant="danger" title="Withdraw this request?" confirmLabel="Withdraw">
              <p>The request closes and any volunteer opportunities for it are canceled.</p>
            </DialogAction>
          ) : null}
        </aside>
      </div>
    </>
  );
}
