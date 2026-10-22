"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { leaderSearch } from "@/app/(app)/(member)/groups/actions";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { archiveGroupAction, createGroupAction, moveCategoryAction, saveCategoryAction, saveCommunitySettingsAction, saveGuidelinesAction, setEligibilityAction } from "./actions";

export function CategoryRow({ category, first, last }: { category?: { id: string; name: string; description: string; active: boolean; threads: number }; first?: boolean; last?: boolean }) {
  const [state, action] = useActionState(saveCategoryAction, initialFormState);
  const [moveState, move] = useActionState(moveCategoryAction, initialFormState);
  const key = category?.id ?? "new";
  return (
    <div className="space-y-3 py-4">
      <FormMessage state={state} />
      <FormMessage state={moveState} />
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end">
        {category ? <input type="hidden" name="id" value={category.id} /> : null}
        <TextField id={`cc-name-${key}`} label={category ? "Name" : "New category"} name="name" required maxLength={60} defaultValue={category?.name} error={state.fieldErrors?.name} />
        <TextField id={`cc-desc-${key}`} label="Description" name="description" maxLength={300} defaultValue={category?.description} optional />
        <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
          {category ? "Save" : "Add"}
        </SubmitButton>
        {category ? (
          <CheckboxField
            id={`cc-active-${key}`}
            name="active"
            label="Shown to members"
            defaultChecked={category.active}
            hint={`${category.threads} discussions. Hiding a category keeps its discussions but stops new posts.`}
            className="sm:col-span-3"
          />
        ) : null}
      </form>
      {category ? (
        <div className="flex gap-2">
          <form action={move}>
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="direction" value="up" />
            <SubmitButton size="sm" variant="ghost" icon={<ArrowUp className="size-4" aria-hidden="true" />}>
              Move up<span className="sr-only"> {category.name}</span>
            </SubmitButton>
          </form>
          <form action={move}>
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="direction" value="down" />
            <SubmitButton size="sm" variant="ghost" icon={<ArrowDown className="size-4" aria-hidden="true" />}>
              Move down<span className="sr-only"> {category.name}</span>
            </SubmitButton>
          </form>
          <span className="sr-only">{first ? "First in the list." : ""}{last ? " Last in the list." : ""}</span>
        </div>
      ) : null}
    </div>
  );
}

export function GuidelinesForm({ text, version, acknowledged }: { text: string; version: number; acknowledged: number }) {
  const [state, action] = useActionState(saveGuidelinesAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextAreaField
        label="Guidelines"
        name="guidelines"
        required
        maxLength={10000}
        rows={12}
        defaultValue={state.values?.guidelines ?? text}
        hint={`Version ${version}, accepted by ${acknowledged} ${acknowledged === 1 ? "member" : "members"}. Bold, italic, lists, and links are supported.`}
      />
      <CheckboxField name="reack" label="Ask everyone to accept the updated guidelines before posting again" hint="Use for meaningful changes; skip for typo fixes." />
      <SubmitButton pendingText="Saving…">Save guidelines</SubmitButton>
    </form>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function CommunitySettingsForm({ s }: { s: { digest_hour: number; weekly_digest_dow: number; dm_retention_days: number; report_evidence_days: number } }) {
  const [state, action] = useActionState(saveCommunitySettingsAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Digest time" name="digestHour" defaultValue={String(s.digest_hour)} hint="Each member's local time (church time zone if they haven't set one).">
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" })}
            </option>
          ))}
        </SelectField>
        <SelectField label="Weekly digest day" name="weeklyDow" defaultValue={String(s.weekly_digest_dow)}>
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </SelectField>
        <TextField label="Keep direct messages for (days)" name="dmRetentionDays" inputMode="numeric" defaultValue={String(s.dm_retention_days)} hint="30–3650. Older messages are erased by the scheduler." />
        <TextField label="Keep report evidence after closing (days)" name="reportEvidenceDays" inputMode="numeric" defaultValue={String(s.report_evidence_days)} hint="7–1095. The report record stays; the captured text is cleared." />
      </div>
      <SubmitButton size="sm" pendingText="Saving…">
        Save settings
      </SubmitButton>
    </form>
  );
}

export function CreateGroupForm() {
  const [state, action] = useActionState(createGroupAction, initialFormState);
  const [visibility, setVisibility] = useState("discoverable");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([]);
  const [leader, setLeader] = useState<{ id: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = window.setTimeout(() => start(async () => setResults(await leaderSearch(term))), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField label="Group name" name="name" required maxLength={80} defaultValue={state.values?.name} />
      <TextAreaField label="Short description" name="summary" maxLength={400} rows={2} defaultValue={state.values?.summary} hint="Shown to all approved members if the group is discoverable." optional />
      <SelectField label="Visibility" name="visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
        <option value="discoverable">Discoverable: members can find it and ask to join</option>
        <option value="hidden">Hidden: only members and community administrators know it exists</option>
      </SelectField>
      {visibility === "discoverable" ? <CheckboxField name="acceptsRequests" label="Accept join requests" defaultChecked /> : null}
      <fieldset className="space-y-2">
        <legend className="font-semibold">First leader</legend>
        <input type="hidden" name="leaderId" value={leader?.id ?? ""} />
        {leader ? (
          <p className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">{leader.name}</span>
            <button type="button" className="font-semibold text-primary underline" onClick={() => setLeader(null)}>
              Change
            </button>
          </p>
        ) : (
          <>
            <TextField label="Search approved members" name="leaderSearch" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
            <p role="status" className="text-sm text-text-secondary">
              {pending ? "Searching…" : q.trim().length >= 2 ? `${results.length} found` : ""}
            </p>
            <ul className="space-y-1">
              {q.trim().length >= 2
                ? results.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="min-h-11 w-full rounded-control px-3 text-left hover:bg-surface-muted" onClick={() => setLeader(r)}>
                        {r.name}
                      </button>
                    </li>
                  ))
                : null}
            </ul>
          </>
        )}
      </fieldset>
      <SubmitButton pendingText="Creating…">Create group</SubmitButton>
    </form>
  );
}

export function ArchiveGroupButton({ groupId, archived, name }: { groupId: string; archived: boolean; name: string }) {
  const [state, action] = useActionState(archiveGroupAction, initialFormState);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="archive" value={String(!archived)} />
      <SubmitButton size="sm" variant={archived ? "secondary" : "danger-outline"} pendingText="Saving…">
        {archived ? "Restore" : "Archive"}
        <span className="sr-only"> {name}</span>
      </SubmitButton>
      {state.status !== "idle" ? <p role="status" className={state.status === "error" ? "text-sm text-danger" : "text-sm text-success"}>{state.message}</p> : null}
    </form>
  );
}

export function EligibilityForm({ profileId, eligible }: { profileId: string; eligible: boolean }) {
  const [state, action] = useActionState(setEligibilityAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="eligible" value={String(!eligible)} />
      {!eligible ? (
        <CheckboxField
          name="confirmAdult"
          label="I have verified this person is an adult (18 or older)"
          hint="For example, from church membership records. Don't enable messaging for anyone under 18."
        />
      ) : null}
      <TextField label="Note (recorded)" name="note" maxLength={300} optional hint="How it was verified, e.g. “membership class record”. Avoid sensitive details." />
      <SubmitButton size="sm" variant={eligible ? "danger-outline" : "primary"} pendingText="Saving…">
        {eligible ? "Turn off direct messaging" : "Turn on direct messaging"}
      </SubmitButton>
    </form>
  );
}
