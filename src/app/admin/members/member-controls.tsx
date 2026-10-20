"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { changeRoleAction, setMemberStatusAction } from "./actions";

type Status = "pending" | "approved" | "suspended";

/** Approve / suspend / reinstate, with an explicit confirmation step before suspending. */
export function StatusControls({ userId, status, name, compact = false }: { userId: string; status: Status; name: string; compact?: boolean }) {
  const [state, action] = useActionState(setMemberStatusAction, initialFormState);
  const [confirming, setConfirming] = useState(false);
  const size = compact ? "sm" : "md";

  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <form action={action} className="flex flex-wrap gap-2" onSubmit={() => setConfirming(false)}>
        <input type="hidden" name="userId" value={userId} />
        {status === "pending" ? (
          <SubmitButton name="status" value="approved" size={size} pendingText="Approving…">
            Approve<span className="sr-only"> {name}</span>
          </SubmitButton>
        ) : null}
        {status === "suspended" ? (
          <SubmitButton name="status" value="approved" size={size} variant="secondary" pendingText="Reinstating…">
            Reinstate<span className="sr-only"> {name}</span>
          </SubmitButton>
        ) : null}
        {status !== "suspended" && !confirming ? (
          <Button size={size} variant="danger-outline" onClick={() => setConfirming(true)}>
            {status === "pending" ? "Decline" : "Suspend"}
            <span className="sr-only"> {name}</span>
          </Button>
        ) : null}
        {confirming ? (
          <div role="group" aria-label={`Confirm suspending ${name}`} className="flex w-full flex-wrap items-center gap-2 rounded-control bg-danger-soft p-3">
            <p className="w-full text-meta">
              {name} will lose access to member areas until reinstated. Continue?
            </p>
            <SubmitButton name="status" value="suspended" size="sm" variant="danger" pendingText="Suspending…">
              Yes, suspend
            </SubmitButton>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}

export function RoleControls({
  userId,
  roles,
  assigned,
}: {
  userId: string;
  roles: Array<{ key: string; name: string; description: string }>;
  assigned: string[];
}) {
  const [state, action] = useActionState(changeRoleAction, initialFormState);
  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      <ul className="divide-y divide-border">
        {roles.map((role) => {
          const has = assigned.includes(role.key);
          return (
            <li key={role.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 max-w-md">
                <p className="font-semibold">
                  {role.name}
                  {has ? <span className="ml-2 text-sm font-semibold text-success">· Assigned</span> : null}
                </p>
                <p className="text-meta text-text-secondary">{role.description}</p>
              </div>
              <form action={action}>
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="role" value={role.key} />
                <input type="hidden" name="op" value={has ? "revoke" : "grant"} />
                <SubmitButton size="sm" variant={has ? "danger-outline" : "secondary"} pendingText={has ? "Removing…" : "Assigning…"}>
                  {has ? "Remove" : "Assign"}
                  <span className="sr-only"> {role.name}</span>
                </SubmitButton>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
