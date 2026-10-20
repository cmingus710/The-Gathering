"use client";

import { Eye, Send } from "lucide-react";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { noteAction, opportunityPublishAction, opportunitySaveAction } from "@/app/(member)/prayer/care-actions";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import { CARE_LIMITS } from "@/lib/prayer/format";
import type { GroupOption, OpportunityPreview } from "@/lib/prayer/types";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/** A small form whose fields are rendered by the server (status, assignment, decisions). */
export function SimpleActionForm({ action, children, submitLabel, variant = "secondary", className }: { action: Action; children: ReactNode; submitLabel: string; variant?: "primary" | "secondary" | "ghost" | "danger-outline"; className?: string }) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      {children}
      <SubmitButton size="sm" variant={variant} pendingText="Saving…">
        {submitLabel}
      </SubmitButton>
      <span role="status" className={state.status === "error" ? "block text-meta text-danger" : "block text-meta text-success"}>
        {state.message ?? ""}
      </span>
    </form>
  );
}

/** Internal note: kept in component state until saved. */
export function NoteForm({ careId }: { careId: string }) {
  const [state, action] = useActionState(noteAction, initialFormState);
  const [body, setBody] = useState("");
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state.status !== "success" || handled.current === state) return;
    handled.current = state;
    setBody("");
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="careId" value={careId} />
      <FormMessage state={state} />
      <TextAreaField label="Add an internal note" name="body" required maxLength={CARE_LIMITS.note} rows={3} value={body} onChange={(e) => setBody(e.target.value)} hint="Operational only (what was arranged, next step). Never shown to the requester. No medical details." />
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        Save note
      </SubmitButton>
    </form>
  );
}

export type OpportunityDraft = {
  id: string;
  title: string;
  details: string;
  date: string;
  time: string;
  endTime: string;
  helpers: number;
  audience: "church" | "group" | "team";
  groupId: string | null;
  logistics: string;
  shareName: boolean;
};

/**
 * Create or edit a volunteer opportunity. The listing fields are shown to
 * everyone in the chosen audience; logistics and the requester's first name
 * only to accepted volunteers, and only with the requester's consent.
 */
export function OpportunityForm({ careId, groups, consent, initial }: { careId: string; groups: GroupOption[]; consent: boolean; initial?: OpportunityDraft }) {
  const [state, action] = useActionState(opportunitySaveAction, initialFormState);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [helpers, setHelpers] = useState(String(initial?.helpers ?? 1));
  const [audience, setAudience] = useState(initial?.audience ?? "church");
  const [groupId, setGroupId] = useState(initial?.groupId ?? groups[0]?.id ?? "");
  const [logistics, setLogistics] = useState(initial?.logistics ?? "");
  const [shareName, setShareName] = useState(initial?.shareName ?? false);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="careId" value={careId} />
      {initial ? <input type="hidden" name="opportunityId" value={initial.id} /> : null}
      <fieldset className="space-y-4 rounded-tile border border-border p-4">
        <legend className="px-1 font-semibold">Shown to everyone who can volunteer</legend>
        <TextField label="Task" name="title" required maxLength={CARE_LIMITS.oppTitle} value={title} onChange={(e) => setTitle(e.target.value)} error={fe.title} hint="Generic: “Deliver a dinner”, not who it's for or why." />
        <TextAreaField label="What volunteers need to know" name="details" optional maxLength={CARE_LIMITS.oppDetails} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} error={fe.details} hint="Never include the request text, health details, phone numbers, or addresses here." />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Date" name="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} error={fe.date} />
          <TextField label="Start" name="time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} error={fe.time} />
          <TextField label="End" name="endTime" type="time" optional value={endTime} onChange={(e) => setEndTime(e.target.value)} error={fe.endTime} />
        </div>
        <TextField label="Helpers needed" name="helpers" type="number" min={1} max={20} required value={helpers} onChange={(e) => setHelpers(e.target.value)} error={fe.helpers} />
        <SelectField label="Who can volunteer?" name="audience" value={audience} onChange={(e) => setAudience(e.target.value as OpportunityDraft["audience"])}>
          <option value="church">Church members</option>
          {groups.length ? <option value="group">One group</option> : null}
          <option value="team">Care coordinators only</option>
        </SelectField>
        {audience === "group" ? (
          <SelectField label="Group" name="groupId" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
        ) : null}
      </fieldset>
      <fieldset className="space-y-4 rounded-tile border border-primary/50 p-4">
        <legend className="px-1 font-semibold">Shared only with volunteers you accept</legend>
        {!consent ? (
          <p className="rounded-tile bg-primary-soft px-3 py-2 text-meta">
            The requester hasn&apos;t agreed to share their name or logistics. Leave these empty, or ask them first (they can change it on their request page).
          </p>
        ) : null}
        <TextAreaField label="Logistics" name="logistics" optional maxLength={CARE_LIMITS.logistics} rows={3} value={logistics} onChange={(e) => setLogistics(e.target.value)} hint="For example a drop-off address and time. Write only what volunteers need; nothing is filled in from the directory." />
        <CheckboxField label="Share the requester's first name" name="shareName" checked={shareName} onChange={(e) => setShareName(e.target.checked)} />
      </fieldset>
      <SubmitButton size="sm" pendingText="Saving…">
        {initial ? "Save changes" : "Save draft"}
      </SubmitButton>
    </form>
  );
}

/** Exactly what each audience will see, and an explicit confirmation to publish. */
export function PublishPreview({ careId, opportunityId, preview, startsLabel }: { careId: string; opportunityId: string; preview: OpportunityPreview; startsLabel: string }) {
  const [state, action] = useActionState(opportunityPublishAction, initialFormState);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-4">
      <h4 className="flex items-center gap-2 font-semibold">
        <Eye className="size-4" aria-hidden="true" /> Preview before publishing
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-tile border border-border bg-surface-muted p-3 text-meta">
          <p className="mb-1 font-semibold">Everyone who can volunteer sees</p>
          <p className="font-semibold">{preview.listing.title}</p>
          <p>{startsLabel}</p>
          <p>{preview.listing.helpers_needed} helper(s) needed{preview.listing.group_name ? ` · ${preview.listing.group_name}` : ""}</p>
          {preview.listing.details ? <p className="mt-1 whitespace-pre-wrap">{preview.listing.details}</p> : null}
        </div>
        <div className="rounded-tile border border-primary/50 p-3 text-meta">
          <p className="mb-1 font-semibold">Accepted volunteers also see</p>
          {preview.accepted.requester_first_name ? <p>First name: {preview.accepted.requester_first_name}</p> : null}
          {preview.accepted.logistics ? <p className="whitespace-pre-wrap">{preview.accepted.logistics}</p> : null}
          {!preview.accepted.requester_first_name && !preview.accepted.logistics ? <p>Nothing beyond the listing{preview.consent ? "" : " (no consent to share details)"}.</p> : null}
          <p className="mt-1 text-text-secondary">Coordinator: {preview.accepted.coordinator ?? "—"}</p>
        </div>
      </div>
      {preview.blocked ? (
        <p className="rounded-tile border border-danger bg-danger-soft px-3 py-2 text-meta">
          Can&apos;t publish yet: the requester hasn&apos;t agreed to share their name or logistics. Edit the draft to remove them, or ask the requester.
        </p>
      ) : (
        <form action={action} className="space-y-3">
          <FormMessage state={state} />
          <input type="hidden" name="careId" value={careId} />
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <CheckboxField label="I've checked what will be shared" name="confirm" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <SubmitButton size="sm" pendingText="Publishing…" icon={<Send className="size-4" aria-hidden="true" />}>
            Publish to volunteers
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
