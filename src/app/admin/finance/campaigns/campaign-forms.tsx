"use client";

import { useActionState } from "react";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { CAMPAIGN_TRANSITIONS, type CampaignStatus } from "@/lib/giving/campaigns";
import { initialFormState } from "@/lib/forms";
import { campaignStatusAction, saveCampaignAction } from "./actions";

export type CampaignFormValues = {
  id: string;
  title: string;
  description: string;
  goal: string;
  startsOn: string;
  endsOn: string;
  fundId: string;
  visibility: "public" | "members";
  imageAlt: string;
  hasImage: boolean;
  fundLocked: boolean;
  status: CampaignStatus;
};

export function CampaignForm({ initial, funds }: { initial?: CampaignFormValues; funds: Array<{ id: string; name: string; active: boolean }> }) {
  const [state, action] = useActionState(saveCampaignAction, initialFormState);
  const v = { ...(initial ?? {}), ...(state.status === "error" ? (state.values ?? {}) : {}) } as Partial<CampaignFormValues> & Record<string, string>;
  const err = state.fieldErrors ?? {};
  const readOnly = initial?.status === "archived";
  const fundChoices = funds.filter((f) => f.active || f.id === v.fundId);
  return (
    <form action={action} noValidate className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <fieldset disabled={readOnly} className="space-y-4">
        <TextField label="Title" name="title" required maxLength={120} defaultValue={v.title} error={err.title} />
        <TextAreaField label="Description" name="description" optional maxLength={2000} hint="Shown on the campaign page. Don't include donor names or amounts." defaultValue={v.description} error={err.description} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Goal (USD)" name="goal" inputMode="decimal" required defaultValue={v.goal} error={err.goal} />
          <TextField label="Starts" name="startsOn" type="date" optional defaultValue={v.startsOn} error={err.startsOn} />
          <TextField label="Ends" name="endsOn" type="date" optional hint="Last day gifts are accepted." defaultValue={v.endsOn} error={err.endsOn} />
        </div>
        {initial?.fundLocked ? (
          <>
            <input type="hidden" name="fundId" value={initial.fundId} />
            <p>
              <span className="font-semibold">Fund:</span> {funds.find((f) => f.id === initial.fundId)?.name ?? "—"}{" "}
              <span className="text-meta text-text-secondary">(fixed once a campaign has been published)</span>
            </p>
          </>
        ) : (
          <SelectField key={v.fundId ?? "default"} label="Fund" name="fundId" hint="Every gift to this campaign is recorded in this fund." defaultValue={v.fundId ?? fundChoices[0]?.id} error={err.fundId}>
            {fundChoices.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </SelectField>
        )}
        <fieldset>
          <legend className="font-semibold">Who can see it</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {(
              [
                ["members", "Approved members only"],
                ["public", "Everyone, including guests"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="visibility" value={value} defaultChecked={(v.visibility ?? "members") === value} className="size-5 accent-primary" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <label htmlFor="campaign-image" className="block font-semibold">
            Image <span className="font-normal text-text-secondary">(optional)</span>
          </label>
          <p id="campaign-image-hint" className="text-meta text-text-secondary">
            JPEG, PNG, or WebP, at least 320 pixels. It&apos;s resized and stored without location or camera details.
          </p>
          <input id="campaign-image" name="image" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="campaign-image-hint" className="block w-full text-sm" />
          {err.image ? <p className="text-meta font-medium text-danger">{err.image[0]}</p> : null}
        </div>
        <TextField label="Image description" name="imageAlt" optional maxLength={200} hint="For people using screen readers, e.g. “The church roof under repair”." defaultValue={v.imageAlt} />
        {initial?.hasImage ? (
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="removeImage" className="size-5 accent-primary" />
            Remove the current image
          </label>
        ) : null}
        <SubmitButton pendingText="Saving…">{initial ? "Save campaign" : "Create draft"}</SubmitButton>
      </fieldset>
    </form>
  );
}

export function CampaignStatusButtons({ id, status }: { id: string; status: CampaignStatus }) {
  const [state, action] = useActionState(campaignStatusAction, initialFormState);
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {CAMPAIGN_TRANSITIONS[status].map((t) => (
          <form key={t.to} action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value={t.to} />
            <SubmitButton size="sm" variant={t.to === "published" ? "primary" : "secondary"} pendingText="Saving…">
              {t.label}
            </SubmitButton>
          </form>
        ))}
      </div>
    </div>
  );
}
