"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { StateBadge } from "@/components/media/badges";
import { Alert } from "@/components/ui/alert";
import { CheckboxField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import type { ItemAdmin } from "@/lib/media/types";
import { setContentStatusAction } from "./actions";

export function PublishPanel({
  item,
  canPublish,
  timeZoneLabel,
  localPublish,
  localExpiry,
  publishedLabel,
}: {
  item: ItemAdmin;
  canPublish: boolean;
  timeZoneLabel: string;
  localPublish: string;
  localExpiry: string;
  publishedLabel: string | null;
}) {
  const [state, action] = useActionState(setContentStatusAction, initialFormState);
  const [when, setWhen] = useState<"now" | "later">(item.state === "scheduled" ? "later" : "now");
  const fe = state.fieldErrors ?? {};
  const isPublic = item.audience === "public";

  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={item.state} />
        {publishedLabel ? <span className="text-meta text-text-secondary">{publishedLabel}</span> : null}
      </div>
      <p>
        <Link href={`/admin/content/${item.id}/preview`} className="font-semibold text-primary hover:underline">
          Preview as members will see it
        </Link>
      </p>
      {item.rights_missing.length ? (
        <Alert tone="warning" title="Rights not confirmed">
          Confirm the source and permission for {item.rights_missing.join(", ")} in the media library before publishing.
        </Alert>
      ) : null}
      {isPublic && item.members_only_files.length ? (
        <Alert tone="info" title="Visitors won't get every file">
          {item.members_only_files.join(", ")} {item.members_only_files.length === 1 ? "stays" : "stay"} members-only.
        </Alert>
      ) : null}
      {!canPublish ? (
        <p className="text-meta text-text-secondary">A content publisher reviews and publishes drafts.</p>
      ) : item.state === "archived" ? (
        <form action={action}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="action" value="restore" />
          <SubmitButton variant="secondary" pendingText="Restoring…">
            Restore as a draft
          </SubmitButton>
        </form>
      ) : (
        <>
          {item.state === "draft" || item.state === "scheduled" ? (
            <form action={action} className="space-y-3">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="action" value="publish" />
              <div role="radiogroup" aria-label="When" className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2">
                  <input type="radio" name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")} className="size-5 accent-primary" />
                  Now
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="when" value="later" checked={when === "later"} onChange={() => setWhen("later")} className="size-5 accent-primary" />
                  At a set time
                </label>
              </div>
              {when === "later" ? (
                <TextField
                  label={`Publish at (${timeZoneLabel})`}
                  name="publish_at"
                  type="datetime-local"
                  defaultValue={state.values?.publish_at ?? localPublish}
                  error={fe.publish_at}
                  hint="It appears at this time on its own; nobody needs to reopen the app."
                />
              ) : null}
              <TextField
                label={`Hide after (${timeZoneLabel})`}
                name="expires_at"
                type="datetime-local"
                defaultValue={state.values?.expires_at ?? localExpiry}
                optional
                error={fe.expires_at}
              />
              {isPublic ? <CheckboxField name="confirm_public" label="I confirm this will be visible to anyone, including people who aren't signed in" /> : null}
              <SubmitButton pendingText="Publishing…">{when === "later" ? (item.state === "scheduled" ? "Update schedule" : "Schedule") : "Publish now"}</SubmitButton>
            </form>
          ) : (
            <form action={action} className="space-y-3">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="action" value="expiry" />
              <TextField
                label={`Hide after (${timeZoneLabel})`}
                name="expires_at"
                type="datetime-local"
                defaultValue={state.values?.expires_at ?? localExpiry}
                optional
                hint="Leave empty to keep it showing."
                error={fe.expires_at}
              />
              <SubmitButton variant="secondary" pendingText="Saving…">
                Save expiry
              </SubmitButton>
            </form>
          )}
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {item.state !== "draft" ? (
              <form action={action}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="action" value="unpublish" />
                <SubmitButton variant="secondary" size="sm" pendingText="Unpublishing…">
                  Unpublish
                </SubmitButton>
              </form>
            ) : null}
            <form action={action}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="action" value="archive" />
              <SubmitButton variant="danger-outline" size="sm" pendingText="Archiving…">
                Archive
              </SubmitButton>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
