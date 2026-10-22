"use client";

import { MessageCircle, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { blockAction, clearConversationAction, recipientSearch, setDmAllowAction, startConversationAction } from "./actions";

export function StartConversationButton({ recipientId, name, icon }: { recipientId: string; name: string; icon?: ReactNode }) {
  const [state, action] = useActionState(startConversationAction, initialFormState);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="recipientId" value={recipientId} />
      <SubmitButton size="sm" variant="secondary" pendingText="Opening…" icon={icon ?? <MessageCircle className="size-4" aria-hidden="true" />}>
        Message<span className="sr-only"> {name}</span>
      </SubmitButton>
      {state.status === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
    </form>
  );
}

/** Search shows only people you may message now who are listed in the directory. */
export function RecipientSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string }> | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = window.setTimeout(() => start(async () => setResults(await recipientSearch(term))), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const shown = q.trim().length < 2 ? null : results;
  return (
    <div className="space-y-3">
      <TextField
        label="Find a member"
        name="q"
        type="search"
        autoComplete="off"
        maxLength={80}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        hint="Type at least two letters of a name. Only members who are listed in the directory and accept your messages appear."
      />
      <p role="status" className="text-sm text-text-secondary">
        {pending ? "Searching…" : shown ? (shown.length ? `${shown.length} found` : "No one found") : ""}
      </p>
      {shown?.length ? (
        <ul className="space-y-2">
          {shown.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-3">
              <span className="font-semibold">{p.name}</span>
              <StartConversationButton recipientId={p.id} name={p.name} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function BlockToggle({ profileId, name, blocked, path }: { profileId: string; name: string; blocked: boolean; path: string }) {
  const [state, action] = useActionState(blockAction, initialFormState);
  return (
    <div className="space-y-2">
      <FormMessage state={state} />
      {blocked ? (
        <form action={action}>
          <input type="hidden" name="profileId" value={profileId} />
          <input type="hidden" name="on" value="false" />
          <input type="hidden" name="path" value={path} />
          <SubmitButton size="sm" variant="secondary" pendingText="Unblocking…">
            Unblock<span className="sr-only"> {name}</span>
          </SubmitButton>
        </form>
      ) : (
        <ConfirmDialog
          trigger={<>Block<span className="sr-only"> {name}</span></>}
          title={`Block ${name}?`}
          confirmLabel="Block"
          formAction={action}
          hidden={{ profileId, on: "true", path }}
        >
          Neither of you will be able to send the other new direct messages, and you won&apos;t get message notifications from them. They aren&apos;t told, and
          your existing messages stay. Blocking doesn&apos;t hide their posts in shared discussions or groups.
        </ConfirmDialog>
      )}
    </div>
  );
}

export function ClearConversationButton({ conversationId }: { conversationId: string }) {
  const [state, action] = useActionState(clearConversationAction, initialFormState);
  return (
    <>
      <ConfirmDialog
        triggerVariant="ghost"
        trigger={<><Trash2 className="size-4" aria-hidden="true" /> Delete conversation</>}
        title="Delete this conversation for you?"
        confirmLabel="Delete for me"
        formAction={action}
        hidden={{ conversationId }}
      >
        Earlier messages disappear from your view. The other person keeps their copy until they delete it too; then the messages are erased.
      </ConfirmDialog>
      {state.status === "error" ? <FormMessage state={state} /> : null}
    </>
  );
}

export function DmAllowForm({ current }: { current: "members" | "shared_groups" | "none" }) {
  const [state, action] = useActionState(setDmAllowAction, initialFormState);
  const options = [
    { value: "members", label: "Approved members", hint: "Any approved adult member who can message (and isn't blocked)." },
    { value: "shared_groups", label: "Only people in my groups", hint: "Only members of a group you're in right now." },
    { value: "none", label: "No one", hint: "No new messages, including in existing conversations. You can still read your history." },
  ] as const;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <fieldset className="space-y-3">
        <legend className="font-semibold">Who can send me direct messages</legend>
        {options.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name="allow" value={o.value} defaultChecked={current === o.value} className="mt-1 size-5 accent-primary" />
            <span>
              <span className="block font-semibold">{o.label}</span>
              <span className="block text-meta text-text-secondary">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <SubmitButton size="sm" pendingText="Saving…">
        Save
      </SubmitButton>
    </form>
  );
}
