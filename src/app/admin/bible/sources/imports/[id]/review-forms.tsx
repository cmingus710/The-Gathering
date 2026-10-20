"use client";

import { useActionState } from "react";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { acceptLinesAction, publishImportAction } from "../../actions";

export type Issue = { line: number; book: string | null; chapter: number | null; verse: number | null; text: string; source_ref: string; issue: string; accepted: boolean };

const WHAT: Record<string, { label: string; accept: string | null }> = {
  empty: { label: "No text (the translation may omit this verse)", accept: "Publish as a deliberately omitted verse" },
  out_of_range: { label: "Beyond the usual verse numbering", accept: "Keep (this translation numbers verses differently)" },
  malformed: { label: "Couldn't be read", accept: "Leave out this line" },
  unknown_book: { label: "Unknown book", accept: "Leave out this line" },
  duplicate: { label: "Repeats an earlier line", accept: null },
};

/** Every flagged line needs a decision; duplicates must be fixed in the file. */
export function IssueList({ importId, issues, editable }: { importId: string; issues: Issue[]; editable: boolean }) {
  const [state, action] = useActionState(acceptLinesAction, initialFormState);
  const decidable = issues.filter((i) => WHAT[i.issue]?.accept);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="import_id" value={importId} />
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-left text-meta">
          <thead className="bg-surface-muted">
            <tr>
              {editable ? (
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Select</span>
                </th>
              ) : null}
              <th scope="col" className="px-3 py-2">Source</th>
              <th scope="col" className="px-3 py-2">Reference</th>
              <th scope="col" className="px-3 py-2">Problem</th>
              <th scope="col" className="px-3 py-2">Text</th>
              <th scope="col" className="px-3 py-2">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {issues.map((i) => (
              <tr key={i.line}>
                {editable ? (
                  <td className="px-3 py-2">
                    {WHAT[i.issue]?.accept ? <input type="checkbox" name="line" value={i.line} aria-label={`Select ${i.source_ref}`} className="size-5 accent-(--color-primary)" /> : null}
                  </td>
                ) : null}
                <td className="px-3 py-2 whitespace-nowrap">{i.source_ref}</td>
                <td className="px-3 py-2 whitespace-nowrap">{i.book ? `${i.book} ${i.chapter ?? "?"}:${i.verse ?? "?"}` : "—"}</td>
                <td className="px-3 py-2">{WHAT[i.issue]?.label ?? i.issue}</td>
                <td className="max-w-md px-3 py-2 break-words">{i.text || <span className="text-text-secondary">(empty)</span>}</td>
                <td className="px-3 py-2">{i.accepted ? <span className="font-semibold text-success">{WHAT[i.issue]?.accept}</span> : WHAT[i.issue]?.accept ? "Waiting" : "Fix the file"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && decidable.length ? (
        <div className="flex flex-wrap gap-2">
          <SubmitButton size="sm" variant="secondary" name="accept" value="1" pendingText="Saving…">
            Accept selected
          </SubmitButton>
          <SubmitButton size="sm" variant="ghost" name="accept" value="0" pendingText="Saving…">
            Undo selected
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

export function PublishForm({ importId, code, missing }: { importId: string; code: string; missing: number }) {
  const [state, action] = useActionState(publishImportAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="import_id" value={importId} />
      <p className="text-meta text-text-secondary">
        Publishing replaces this translation&apos;s stored text with the reviewed lines, all at once. Members see the new text immediately; their highlights and bookmarks keep pointing at the same verse numbers.
      </p>
      {missing ? <CheckboxField name="acknowledge_missing" label={`I've checked the ${missing} missing verse${missing > 1 ? "s" : ""}; publish without ${missing > 1 ? "them" : "it"}.`} /> : null}
      <TextAreaField label="Review note" name="note" optional rows={2} maxLength={1000} hint="For example what you compared the text against." />
      <TextField label={`Type ${code} to publish`} name="confirm" autoComplete="off" required />
      <SubmitButton pendingText="Publishing…">Publish reviewed text</SubmitButton>
    </form>
  );
}
