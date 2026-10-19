"use client";

/* eslint-disable @next/next/no-img-element -- signed-URL and object-URL previews */
import { LogOut, Send, UserMinus, UserPlus } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { MAX_COVER_BYTES } from "@/lib/events/limits";
import { initialFormState, type FormState } from "@/lib/forms";
import {
  decideRequestAction,
  inviteAction,
  inviteSearch,
  leaderSearch,
  leaveGroupAction,
  memberAction,
  requestJoinAction,
  respondInvitationAction,
  revokeInvitationAction,
  saveGroupAction,
  withdrawRequestAction,
} from "./actions";

function Hidden({ values }: { values: Record<string, string> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

export function RequestJoinForm({ groupId, name }: { groupId: string; name: string }) {
  const [state, action] = useActionState(requestJoinAction, initialFormState);
  const [message, setMessage] = useState("");
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <Hidden values={{ groupId }} />
      <TextAreaField
        label="Note to the leaders"
        name="message"
        optional
        maxLength={500}
        rows={2}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        hint="Shown only to this group's leaders."
      />
      <SubmitButton size="sm" pendingText="Sending…" icon={<Send className="size-4" aria-hidden="true" />}>
        Ask to join<span className="sr-only"> {name}</span>
      </SubmitButton>
    </form>
  );
}

export function WithdrawRequestButton({ groupId }: { groupId: string }) {
  const [state, action] = useActionState(withdrawRequestAction, initialFormState);
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <Hidden values={{ groupId }} />
      <SubmitButton size="sm" variant="secondary" pendingText="Withdrawing…">
        Withdraw request
      </SubmitButton>
    </form>
  );
}

export function RespondInvitation({ invitationId, groupName }: { invitationId: string; groupName: string }) {
  const [state, action] = useActionState(respondInvitationAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <Hidden values={{ invitationId }} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="answer" value="accept" size="sm" pendingText="Joining…">
          Accept<span className="sr-only"> invitation to {groupName}</span>
        </SubmitButton>
        <SubmitButton name="answer" value="decline" size="sm" variant="secondary" pendingText="Declining…">
          Decline<span className="sr-only"> invitation to {groupName}</span>
        </SubmitButton>
      </div>
    </form>
  );
}

export function LeaveGroupButton({ groupId, isLeader }: { groupId: string; isLeader: boolean }) {
  const [state, action] = useActionState(leaveGroupAction, initialFormState);
  return (
    <div className="space-y-2">
      <FormMessage state={state} />
      <ConfirmDialog trigger={<><LogOut className="size-4" aria-hidden="true" /> Leave group</>} title="Leave this group?" confirmLabel="Leave group" formAction={action} hidden={{ groupId }}>
        You&apos;ll lose access to its discussions, roster, and group-only events right away, and any group-event registrations will be canceled.
        {isLeader ? " As a leader, you can leave only if another leader remains." : ""}
      </ConfirmDialog>
    </div>
  );
}

export function DecideRequest({ requestId, groupId, name }: { requestId: string; groupId: string; name: string }) {
  const [state, action] = useActionState(decideRequestAction, initialFormState);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <Hidden values={{ requestId, groupId }} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="answer" value="approve" size="sm" pendingText="Approving…">
          Approve<span className="sr-only"> {name}</span>
        </SubmitButton>
        <SubmitButton name="answer" value="decline" size="sm" variant="secondary" pendingText="Declining…">
          Decline<span className="sr-only"> {name}</span>
        </SubmitButton>
      </div>
    </form>
  );
}

export function RevokeInvitation({ invitationId, groupId, name }: { invitationId: string; groupId: string; name: string }) {
  const [state, action] = useActionState(revokeInvitationAction, initialFormState);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action}>
      <FormMessage state={state} />
      <Hidden values={{ invitationId, groupId }} />
      <SubmitButton size="sm" variant="ghost" pendingText="Withdrawing…">
        Withdraw<span className="sr-only"> invitation to {name}</span>
      </SubmitButton>
    </form>
  );
}

export function MemberControls({
  groupId,
  profileId,
  name,
  role,
  isAdmin,
}: {
  groupId: string;
  profileId: string;
  name: string;
  role: "member" | "leader";
  isAdmin: boolean;
}) {
  const [state, action] = useActionState(memberAction, initialFormState);
  return (
    <div className="space-y-2">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {isAdmin && role === "member" ? (
          <form action={action}>
            <Hidden values={{ groupId, profileId, op: "add_leader" }} />
            <SubmitButton size="sm" variant="secondary">
              Make leader<span className="sr-only"> ({name})</span>
            </SubmitButton>
          </form>
        ) : null}
        {isAdmin && role === "leader" ? (
          <form action={action}>
            <Hidden values={{ groupId, profileId, op: "remove_leader_role" }} />
            <SubmitButton size="sm" variant="secondary">
              Remove leader role<span className="sr-only"> ({name})</span>
            </SubmitButton>
          </form>
        ) : null}
        {role === "member" || isAdmin ? (
          <ConfirmDialog
            triggerVariant="danger-outline"
            trigger={<><UserMinus className="size-4" aria-hidden="true" /> Remove<span className="sr-only"> {name}</span></>}
            title={`Remove ${name} from the group?`}
            confirmLabel="Remove"
            formAction={action}
            hidden={{ groupId, profileId, op: "remove" }}
          >
            Their access to the group&apos;s discussions, roster, and group-only events ends immediately, and group-event registrations are canceled. They&apos;re told
            they&apos;re no longer a member.
          </ConfirmDialog>
        ) : null}
      </div>
    </div>
  );
}

/** Member search (debounced) that returns only people the caller may invite or appoint. */
function PeoplePicker({
  label,
  hint,
  search,
  render,
}: {
  label: string;
  hint: string;
  search: (q: string) => Promise<Array<{ id: string; name: string }>>;
  render: (person: { id: string; name: string }) => React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string }> | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = window.setTimeout(() => start(async () => setResults(await search(term))), 300);
    return () => window.clearTimeout(t);
  }, [q, search]);
  const shown = q.trim().length < 2 ? null : results;
  return (
    <div className="space-y-3">
      <TextField label={label} name="q" type="search" hint={hint} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" maxLength={80} />
      <p role="status" className="text-sm text-text-secondary">
        {pending ? "Searching…" : shown ? (shown.length ? `${shown.length} found` : "No one found") : ""}
      </p>
      {shown?.length ? (
        <ul className="space-y-2">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-muted px-4 py-3">
              <span className="font-semibold">{p.name}</span>
              {render(p)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function InviteOne({ groupId, person }: { groupId: string; person: { id: string; name: string } }) {
  const [state, action] = useActionState(inviteAction, initialFormState);
  if (state.status === "success") return <span className="text-sm font-semibold text-success" role="status">Invited</span>;
  return (
    <form action={action} className="space-y-1">
      <Hidden values={{ groupId, inviteeId: person.id }} />
      <SubmitButton size="sm" variant="secondary" pendingText="Sending…" icon={<UserPlus className="size-4" aria-hidden="true" />}>
        Invite<span className="sr-only"> {person.name}</span>
      </SubmitButton>
      {state.status === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
    </form>
  );
}

export function InvitePicker({ groupId }: { groupId: string }) {
  return (
    <PeoplePicker
      label="Invite a member"
      hint="Search by name. Only members listed in the directory appear. They must accept the invitation to join."
      search={(q) => inviteSearch(groupId, q)}
      render={(p) => <InviteOne groupId={groupId} person={p} />}
    />
  );
}

function AppointOne({ groupId, person }: { groupId: string; person: { id: string; name: string } }) {
  const [state, action] = useActionState(memberAction, initialFormState);
  if (state.status === "success") return <span className="text-sm font-semibold text-success" role="status">Appointed</span>;
  return (
    <form action={action} className="space-y-1">
      <Hidden values={{ groupId, profileId: person.id, op: "add_leader" }} />
      <SubmitButton size="sm" variant="secondary" pendingText="Appointing…">
        Appoint<span className="sr-only"> {person.name} as leader</span>
      </SubmitButton>
      {state.status === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
    </form>
  );
}

export function LeaderPicker({ groupId }: { groupId: string }) {
  return (
    <PeoplePicker
      label="Appoint a leader"
      hint="Community administrators only. Appointing someone also adds them to the group."
      search={leaderSearch}
      render={(p) => <AppointOne groupId={groupId} person={p} />}
    />
  );
}

export function GroupDetailsForm({
  group,
  imageUrl,
  isAdmin,
}: {
  group: { id: string; name: string; summary: string; about: string | null; image_path: string | null; image_alt: string | null; visibility: "discoverable" | "hidden"; accepts_requests: boolean };
  imageUrl: string | null;
  isAdmin: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveGroupAction, initialFormState);
  const [preview, setPreview] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [visibility, setVisibility] = useState(group.visibility);
  const v = state.values;
  const fe = state.fieldErrors ?? {};
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      <FormMessage state={state} />
      <Hidden values={{ groupId: group.id, currentImage: group.image_path ?? "" }} />
      <TextField label="Name" name="name" required maxLength={80} defaultValue={v?.name ?? group.name} error={fe.name} />
      <TextAreaField
        label="Short description"
        name="summary"
        maxLength={400}
        rows={2}
        defaultValue={v?.summary ?? group.summary}
        error={fe.summary}
        hint={group.visibility === "discoverable" ? "Shown to all approved members in the group directory. Don't include private details." : "Shown only to members (this group is hidden)."}
      />
      {group.about !== null ? (
        <TextAreaField
          label="Details for members"
          name="about"
          maxLength={5000}
          rows={4}
          defaultValue={v?.about ?? group.about}
          error={fe.about}
          hint="Meeting time and place, what to bring. Only active members see this."
        />
      ) : (
        <p className="text-[0.95rem] text-text-secondary">The members-only details are visible to the group&apos;s members, so they aren&apos;t shown here.</p>
      )}
      {isAdmin ? (
        <SelectField label="Visibility" name="visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as "discoverable" | "hidden")}>
          <option value="discoverable">Discoverable: members can find it and ask to join</option>
          <option value="hidden">Hidden: only members and community administrators know it exists</option>
        </SelectField>
      ) : null}
      {visibility === "discoverable" ? (
        <CheckboxField name="acceptsRequests" label="Accept join requests" defaultChecked={group.accepts_requests} hint="Otherwise the group is invitation only." />
      ) : null}
      <fieldset className="space-y-3">
        <legend className="font-semibold">Image</legend>
        {preview || imageUrl ? <img src={preview ?? imageUrl ?? ""} alt="" className="max-h-48 rounded-card object-cover" /> : null}
        <input
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="group-image-hint"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setTooLarge(!!f && f.size > MAX_COVER_BYTES);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
          className="block w-full text-sm"
        />
        <p id="group-image-hint" className="text-[0.95rem] text-text-secondary">
          JPEG, PNG, or WebP up to 4 MB. It&apos;s resized and its location data removed. Visible to anyone who can see the group.
        </p>
        {tooLarge ? <p role="alert" className="text-sm text-danger">That file is over 4 MB. Choose a smaller image.</p> : null}
        {fe.image ? <p role="alert" className="text-sm text-danger">{fe.image[0]}</p> : null}
        <TextField label="Image description" name="imageAlt" maxLength={300} defaultValue={v?.imageAlt ?? group.image_alt ?? ""} error={fe.imageAlt} hint="Describe the image for people who can't see it." />
        {group.image_path ? <CheckboxField name="removeImage" label="Remove the current image" /> : null}
      </fieldset>
      <SubmitButton pendingText="Saving…">
        Save details
      </SubmitButton>
    </form>
  );
}
