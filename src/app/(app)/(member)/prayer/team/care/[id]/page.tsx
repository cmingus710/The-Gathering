import { History, Lock, MessagesSquare, NotebookPen, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/community/live-refresh";
import { CareMessageForm } from "@/components/prayer/care-forms";
import { NoteForm, OpportunityForm, PublishPreview, SimpleActionForm } from "@/components/prayer/team-forms";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { requireApprovedMember } from "@/lib/auth/viewer";
import { exactTime, relativeTime } from "@/lib/community/format";
import { tryCommunityRpc } from "@/lib/community/queries";
import {
  CARE_ACTIVITY_LABEL,
  CARE_KIND_LABEL,
  CARE_STATUS_LABEL,
  CARE_STATUSES,
  CLOSED_REASON_LABEL,
  CONTACT_LABEL,
  dateRange,
  formatDay,
  OPPORTUNITY_STATUS_LABEL,
  SIGNUP_LABEL,
} from "@/lib/prayer/format";
import type { GroupOption, OpportunityPreview, TeamCareRequest } from "@/lib/prayer/types";
import { getChurchSettings } from "@/lib/settings/queries";
import { formatDateTime, utcToZonedLocal } from "@/lib/time";
import { assignAction, opportunityStatusAction, signupDecideAction, teamUpdateAction } from "../../../care-actions";

export const metadata: Metadata = { title: "Care request (team)" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function TeamCarePage({ params }: PageProps<"/prayer/team/care/[id]">) {
  const { id } = await params;
  const viewer = await requireApprovedMember(`/prayer/team/care/${id}`);
  if (!UUID.test(id) || !viewer.capabilities.has(CAPABILITIES.careCoordinate)) notFound();
  const [c, { settings }, groups] = await Promise.all([
    tryCommunityRpc<TeamCareRequest>("care_team_request", { p_id: id }),
    getChurchSettings(),
    tryCommunityRpc<GroupOption[]>("prayer_my_groups"),
  ]);
  if (!c) notFound();
  const tz = settings.timezone;
  const coordinators = c.can_assign ? ((await tryCommunityRpc<{ id: string; name: string }[]>("care_team_coordinators")) ?? []) : [];
  const drafts = c.opportunities.filter((o) => o.status === "draft");
  const previews = new Map<string, OpportunityPreview>();
  if (c.can_act) {
    for (const o of drafts) {
      const p = await tryCommunityRpc<OpportunityPreview>("care_opportunity_preview", { p_id: o.id });
      if (p) previews.set(o.id, p);
    }
  }
  const when = dateRange(c.needed_on, c.needed_until);

  return (
    <>
      <LiveRefresh />
      <BackLink route="/prayer/team/care/[id]" />
      <header className="mb-6">
        <p className="mb-1 flex items-center gap-1.5 text-meta font-semibold text-primary">
          <Lock className="size-3.5" aria-hidden="true" /> Care team only · {CARE_KIND_LABEL[c.kind]}
        </p>
        <h1 className="font-display text-[1.75rem] font-semibold leading-tight">{c.summary}</h1>
        <p className="mt-1 text-meta text-text-secondary">
          From {c.requester} · <time dateTime={c.created_at} title={exactTime(c.created_at, tz)}>{relativeTime(c.created_at)}</time> · {CARE_STATUS_LABEL[c.status]}
          {c.status === "closed" && c.closed_reason ? ` (${CLOSED_REASON_LABEL[c.closed_reason] ?? c.closed_reason})` : ""}
        </p>
      </header>
      {!c.can_act ? <Alert tone="info" title={`Assigned to ${c.assigned}. You can read this request; only the assigned coordinator and care leads can change it.`} className="mb-6" /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card className="space-y-2">
            <h2 className="font-semibold">Request</h2>
            {when ? <p className="text-meta"><strong>When:</strong> {when}</p> : null}
            <p className="text-meta">
              <strong>Preferred contact:</strong> {CONTACT_LABEL[c.contact_method]}
              {c.contact ? <> · <span className="font-semibold">{c.contact}</span></> : null}
            </p>
            {c.contact_note ? <p className="text-meta"><strong>Notes:</strong> {c.contact_note}</p> : null}
            {c.details ? <p className="whitespace-pre-wrap">{c.details}</p> : <p className="text-text-secondary">No further details.</p>}
            <p className="text-meta text-text-secondary">
              Sharing with volunteers: {c.share_consent ? `allowed by the requester${c.consent_at ? ` (${relativeTime(c.consent_at)})` : ""}` : "not allowed"}.
            </p>
          </Card>

          <section aria-labelledby="msgs" className="space-y-3">
            <h2 id="msgs" className="flex items-center gap-2 font-semibold">
              <MessagesSquare className="size-5" aria-hidden="true" /> Messages with the requester
            </h2>
            <p className="text-meta text-text-secondary">The requester sees everything in this section.</p>
            {c.messages.length ? (
              <ol className="space-y-3">
                {c.messages.map((m) => (
                  <li key={m.id} className={`rounded-card border p-4 ${m.from_team ? "border-primary/40 bg-primary-soft" : "border-border bg-surface"}`}>
                    <p className="mb-1 text-meta">
                      <span className="font-semibold">{m.from_team ? `${m.author} (care team)` : `${m.author} (requester)`}</span> ·{" "}
                      <time dateTime={m.created_at} className="text-text-secondary">{relativeTime(m.created_at)}</time>
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-text-secondary">No messages yet.</p>
            )}
            {c.can_act && c.status !== "closed" ? (
              <Card>
                <CareMessageForm careId={c.id} label="Reply to the requester" hint="The requester will see this. They're told there's a response, without its text, outside the app." />
              </Card>
            ) : null}
          </section>

          <section aria-labelledby="notes" className="space-y-3 rounded-card border-2 border-dashed border-border p-5">
            <h2 id="notes" className="flex items-center gap-2 font-semibold">
              <NotebookPen className="size-5" aria-hidden="true" /> Internal notes
            </h2>
            <p className="text-meta text-text-secondary">Never shown to the requester or volunteers. Visible only to the assigned coordinator and care leads.</p>
            {c.can_read_notes && c.notes ? (
              <>
                {c.notes.length ? (
                  <ol className="space-y-2">
                    {c.notes.map((n) => (
                      <li key={n.id} className="rounded-tile bg-surface-muted p-3">
                        <p className="mb-1 text-meta text-text-secondary">
                          {n.author} · {relativeTime(n.created_at)}
                        </p>
                        <p className="whitespace-pre-wrap">{n.body}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-text-secondary">No notes yet.</p>
                )}
                {c.status !== "closed" ? <NoteForm careId={c.id} /> : null}
              </>
            ) : (
              <p className="text-meta">You can read internal notes once this request is assigned to you.</p>
            )}
          </section>

          <section aria-labelledby="opps" className="space-y-3">
            <h2 id="opps" className="flex items-center gap-2 font-semibold">
              <Users className="size-5" aria-hidden="true" /> Volunteer help
            </h2>
            {c.opportunities.map((o) => (
              <Card key={o.id} className="space-y-3">
                <p className="text-meta font-semibold text-primary">{OPPORTUNITY_STATUS_LABEL[o.status]}</p>
                <h3 className="font-semibold">{o.title}</h3>
                <p className="text-meta text-text-secondary">
                  {formatDateTime(o.starts_at, tz)} · {o.accepted_count} of {o.helpers_needed} helpers
                </p>
                {o.status === "draft" && previews.get(o.id) ? (
                  <PublishPreview careId={c.id} opportunityId={o.id} preview={previews.get(o.id)!} startsLabel={formatDateTime(o.starts_at, tz)} />
                ) : null}
                {o.signups.length ? (
                  <ul className="space-y-2">
                    {o.signups.map((s) => (
                      <li key={s.profile_id} className="flex flex-wrap items-center justify-between gap-2 rounded-tile bg-surface-muted p-3 text-meta">
                        <span>
                          <strong>{s.name}</strong> · {SIGNUP_LABEL[s.status].replace("You offered", "Offered").replace("You're confirmed", "Accepted").replace("You withdrew", "Withdrew")}
                          {s.note ? <span className="block text-text-secondary">“{s.note}”</span> : null}
                        </span>
                        {c.can_act ? (
                          <span className="flex flex-wrap gap-1">
                            {s.status === "offered" ? (
                              <SimpleActionForm action={signupDecideAction} submitLabel="Accept" variant="secondary" className="inline-flex items-center gap-1">
                                <input type="hidden" name="careId" value={c.id} />
                                <input type="hidden" name="opportunityId" value={o.id} />
                                <input type="hidden" name="profileId" value={s.profile_id} />
                                <input type="hidden" name="decision" value="accept" />
                              </SimpleActionForm>
                            ) : null}
                            {s.status === "offered" || s.status === "accepted" ? (
                              <SimpleActionForm action={signupDecideAction} submitLabel="Decline" variant="ghost" className="inline-flex items-center gap-1">
                                <input type="hidden" name="careId" value={c.id} />
                                <input type="hidden" name="opportunityId" value={o.id} />
                                <input type="hidden" name="profileId" value={s.profile_id} />
                                <input type="hidden" name="decision" value="decline" />
                              </SimpleActionForm>
                            ) : null}
                            {s.status === "accepted" ? (
                              <SimpleActionForm action={signupDecideAction} submitLabel="Mark done" variant="ghost" className="inline-flex items-center gap-1">
                                <input type="hidden" name="careId" value={c.id} />
                                <input type="hidden" name="opportunityId" value={o.id} />
                                <input type="hidden" name="profileId" value={s.profile_id} />
                                <input type="hidden" name="decision" value="complete" />
                              </SimpleActionForm>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : o.status !== "draft" ? (
                  <p className="text-meta text-text-secondary">No volunteers yet.</p>
                ) : null}
                {c.can_act && (o.status === "draft" || o.status === "open") ? (
                  <details>
                    <summary className="cursor-pointer text-meta font-semibold text-primary">Edit</summary>
                    <div className="mt-3">
                      <OpportunityForm
                        careId={c.id}
                        groups={groups ?? []}
                        consent={c.share_consent}
                        initial={{
                          id: o.id,
                          title: o.title,
                          details: o.details,
                          date: utcToZonedLocal(o.starts_at, tz).slice(0, 10),
                          time: utcToZonedLocal(o.starts_at, tz).slice(11, 16),
                          endTime: o.ends_at ? utcToZonedLocal(o.ends_at, tz).slice(11, 16) : "",
                          helpers: o.helpers_needed,
                          audience: o.audience,
                          groupId: o.group_id,
                          logistics: o.logistics,
                          shareName: o.share_name,
                        }}
                      />
                    </div>
                  </details>
                ) : null}
                {c.can_act && o.status !== "draft" && o.status !== "canceled" && o.status !== "completed" ? (
                  <SimpleActionForm action={opportunityStatusAction} submitLabel="Update" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="careId" value={c.id} />
                    <input type="hidden" name="opportunityId" value={o.id} />
                    <label className="text-meta font-semibold">
                      <span className="block">Opportunity status</span>
                      <select name="status" defaultValue={o.status} className="min-h-11 rounded-control border border-border-strong bg-surface px-3 text-base">
                        <option value="open">Open</option>
                        <option value="filled">Filled</option>
                        <option value="completed">Completed</option>
                        <option value="canceled">Canceled</option>
                      </select>
                    </label>
                  </SimpleActionForm>
                ) : null}
              </Card>
            ))}
            {c.can_act && c.status !== "closed" ? (
              <details className="rounded-card border border-border bg-surface p-5">
                <summary className="cursor-pointer font-semibold">Ask for volunteers</summary>
                <p className="mt-2 text-meta text-text-secondary">Saved as a draft first. You&apos;ll see exactly what will be shared before publishing. Nothing is published automatically.</p>
                <div className="mt-4">
                  <OpportunityForm careId={c.id} groups={groups ?? []} consent={c.share_consent} />
                </div>
              </details>
            ) : null}
          </section>
        </div>

        <aside className="space-y-4">
          {c.can_act ? (
            <Card>
              <h2 className="mb-3 font-semibold">Status and follow-up</h2>
              <SimpleActionForm action={teamUpdateAction} submitLabel="Save">
                <input type="hidden" name="careId" value={c.id} />
                <label className="block space-y-1 text-meta font-semibold">
                  <span className="block">Status</span>
                  <select name="status" defaultValue={c.status} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-base">
                    {CARE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {CARE_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-meta font-semibold">
                  <span className="block">If closing, why?</span>
                  <select name="closedReason" defaultValue={c.closed_reason ?? "fulfilled"} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-base">
                    {["fulfilled", "resolved", "declined"].map((r) => (
                      <option key={r} value={r}>
                        {CLOSED_REASON_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-meta font-semibold">
                  <span className="block">Follow-up date (reminds the assigned coordinator)</span>
                  <input type="date" name="followUpOn" defaultValue={c.follow_up_on ?? ""} className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-base" />
                </label>
              </SimpleActionForm>
            </Card>
          ) : null}
          <Card>
            <h2 className="mb-2 font-semibold">Coordinator</h2>
            <p className="mb-3 text-meta">{c.assigned ? (c.assigned_me ? "You" : c.assigned) : "Unassigned"}{c.follow_up_on ? ` · follow up ${formatDay(c.follow_up_on)}` : ""}</p>
            {c.can_assign && c.status !== "closed" ? (
              <SimpleActionForm action={assignAction} submitLabel="Assign">
                <input type="hidden" name="careId" value={c.id} />
                <label className="block space-y-1 text-meta font-semibold">
                  <span className="block">Assign to</span>
                  <select name="assignee" defaultValue="" className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-base">
                    <option value="">Unassigned</option>
                    {coordinators.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </SimpleActionForm>
            ) : null}
          </Card>
          <Card>
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <History className="size-4" aria-hidden="true" /> Activity
            </h2>
            <ol className="space-y-2 text-meta">
              {c.activity.map((a, i) => (
                <li key={i}>
                  <span className="font-semibold">{CARE_ACTIVITY_LABEL[a.action] ?? a.action}</span>
                  {a.action === "status_changed" && typeof a.detail.to === "string" ? ` to ${CARE_STATUS_LABEL[a.detail.to as keyof typeof CARE_STATUS_LABEL] ?? a.detail.to}` : ""}
                  {a.assignee ? ` to ${a.assignee}` : ""}
                  <span className="block text-text-secondary">
                    {a.actor ?? "System"} · {relativeTime(a.at)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
