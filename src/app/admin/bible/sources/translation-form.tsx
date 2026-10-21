"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { codeFromAbbreviation, type ApiBibleSummary } from "@/lib/bible/api-bible";
import type { BibleListResult } from "@/lib/bible/source";
import { initialFormState } from "@/lib/forms";
import { listApiBiblesAction, saveTranslationAction, translationStatusAction } from "./actions";

export type AdminTranslation = {
  id: string;
  code: string;
  name: string;
  language: string;
  source_kind: "database" | "api";
  provider: string | null;
  provider_ref: string | null;
  credential_env: string | null;
  attribution: string;
  copyright: string;
  source_url: string | null;
  source_notes: string;
  rights: "unverified" | "public_domain" | "licensed" | "permission";
  rights_notes: string;
  rights_confirmed_at: string | null;
  rights_confirmed_by_name: string | null;
  allow_cache: boolean;
  cache_days: number | null;
  allow_copy: boolean;
  allow_print: boolean;
  allow_export: boolean;
  max_verses_per_view: number;
  tracking_required: boolean;
  status: "draft" | "active" | "retired";
  verse_count: number;
  text_version: number;
  is_default: boolean;
  plans: number;
};

/**
 * Translation settings. Rights and permissions start at the most
 * restrictive values, and changing them clears the confirmation until it is
 * given again. API keys are never entered here: only the name of the server
 * environment variable that holds the key.
 */
export function TranslationForm({ t }: { t: AdminTranslation | null }) {
  const [state, action] = useActionState(saveTranslationAction, initialFormState);
  const [kind, setKind] = useState<"database" | "api">(t?.source_kind ?? "database");
  const [cache, setCache] = useState(t?.allow_cache ?? false);
  const [credential, setCredential] = useState(state.values?.credential_env ?? t?.credential_env ?? "API_BIBLE_KEY");
  // A Bible chosen from the provider's list fills these fields (they remount with it).
  const [picked, setPicked] = useState<ApiBibleSummary | null>(null);
  const v = (k: string, d: string) => state.values?.[k] ?? d;
  const pk = picked?.id ?? "";
  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      {t ? <input type="hidden" name="id" value={t.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        {t ? (
          <TextField label="Code" name="code_display" value={t.code} disabled />
        ) : (
          <TextField key={`code-${pk}`} label="Code" name="code" required maxLength={16} defaultValue={picked ? codeFromAbbreviation(picked.abbreviation) : v("code", "")} hint="Shown beside every passage, e.g. WEB." error={state.fieldErrors?.code} />
        )}
        <TextField key={`name-${pk}`} label="Name" name="name" required maxLength={120} defaultValue={picked && !t ? picked.name.slice(0, 120) : v("name", t?.name ?? "")} />
      </div>
      {t ? (
        <p className="text-meta text-text-secondary">Source: {t.source_kind === "database" ? "text stored in the app from a reviewed import" : `licensed API (${t.provider})`}.</p>
      ) : (
        <SelectField label="Where the text comes from" name="source_kind" value={kind} onChange={(e) => setKind(e.target.value as "database" | "api")}>
          <option value="database">Stored in the app (import a structured file, review, publish)</option>
          <option value="api">A licensed scripture API (API.Bible)</option>
        </SelectField>
      )}
      {(t?.source_kind ?? kind) === "api" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              key={`ref-${pk}`}
              label="API.Bible Bible ID"
              name="provider_ref"
              defaultValue={picked ? picked.id : v("provider_ref", t?.provider_ref ?? "")}
              maxLength={64}
              hint="The bible_id (e.g. de4e12af7f28f599-01), not the shorter DBL ID. Choose it from the list below."
            />
            <TextField label="Server setting holding the key" name="credential_env" value={credential} onChange={(e) => setCredential(e.target.value)} maxLength={64} hint="The environment variable NAME in Vercel. Never paste the key here." />
          </div>
          <ApiBiblePicker credential={credential} chosen={picked?.id ?? null} onPick={setPicked} />
        </>
      ) : null}
      <TextField key={`lang-${pk}`} label="Language" name="language" defaultValue={picked && !t && picked.language ? picked.language : v("language", t?.language ?? "en")} maxLength={12} />
      <TextAreaField label="Attribution shown with passages" name="attribution" rows={2} maxLength={1000} defaultValue={v("attribution", t?.attribution ?? "")} />
      <TextAreaField label="Copyright notice" name="copyright" rows={2} maxLength={2000} defaultValue={v("copyright", t?.copyright ?? "")} hint="The exact wording the license requires, if any." />
      <TextField label="Source link" name="source_url" type="url" optional defaultValue={v("source_url", t?.source_url ?? "")} />
      <TextAreaField label="Source notes" name="source_notes" optional rows={2} maxLength={2000} defaultValue={v("source_notes", t?.source_notes ?? "")} />

      <fieldset className="space-y-3 rounded-tile border border-border p-4">
        <legend className="px-1 font-semibold">Rights and permissions</legend>
        <SelectField label="Basis for using this text" name="rights" defaultValue={v("rights", t?.rights ?? "unverified")}>
          <option value="unverified">Not verified yet</option>
          <option value="public_domain">Public domain</option>
          <option value="licensed">Licensed (API or publisher license)</option>
          <option value="permission">Written permission</option>
        </SelectField>
        <TextAreaField label="What the license says" name="rights_notes" rows={3} maxLength={4000} defaultValue={v("rights_notes", t?.rights_notes ?? "")} hint="Display, storage, caching, copying, printing, and export terms, and where you checked them." />
        <CheckboxField name="allow_cache" label="The license allows keeping a temporary copy" checked={cache} onChange={(e) => setCache(e.target.checked)} />
        {cache ? <TextField label="Keep copies for at most (days)" name="cache_days" type="number" min={1} max={30} defaultValue={v("cache_days", String(t?.cache_days ?? 1))} /> : null}
        <CheckboxField name="allow_copy" label="Members may copy text" defaultChecked={t?.allow_copy ?? false} />
        <CheckboxField name="allow_print" label="Members may print" defaultChecked={t?.allow_print ?? false} />
        <CheckboxField name="allow_export" label="Text may be included in exports" defaultChecked={t?.allow_export ?? false} />
        <TextField label="Most verses on one page" name="max_verses_per_view" type="number" min={1} max={5000} defaultValue={v("max_verses_per_view", String(t?.max_verses_per_view ?? 500))} />
        {(t?.source_kind ?? kind) === "api" ? <CheckboxField name="tracking_required" label="Provider requires its usage-tracking script (API.Bible FUMS)" defaultChecked={t?.tracking_required ?? true} /> : null}
        <CheckboxField
          name="confirm_rights"
          label="I've checked the current terms and confirm these permissions."
          hint={t?.rights_confirmed_at ? `Last confirmed ${new Date(t.rights_confirmed_at).toLocaleDateString("en-US")}${t.rights_confirmed_by_name ? ` by ${t.rights_confirmed_by_name}` : ""}.` : "Required before the translation can be activated."}
        />
      </fieldset>
      <SubmitButton pendingText="Saving…">{t ? "Save translation" : "Add translation"}</SubmitButton>
    </form>
  );
}

const LIST_PROBLEM: Record<Exclude<BibleListResult, { status: "ok" }>["reason"], string> = {
  not_configured: "That server setting isn't set (or API_BIBLE_BASE_URL isn't an API.Bible address). Add the key in Vercel and redeploy.",
  rejected: "API.Bible didn't accept the key in that server setting.",
  outage: "API.Bible couldn't be reached right now. Try again shortly.",
};

/**
 * Lists the Bibles the key can use (API.Bible's GET /bibles) so the right
 * bible_id is chosen rather than typed. Choosing one only fills the form;
 * nothing is saved until the form is submitted.
 */
function ApiBiblePicker({ credential, chosen, onPick }: { credential: string; chosen: string | null; onPick: (b: ApiBibleSummary) => void }) {
  const [result, setResult] = useState<BibleListResult | null>(null);
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();
  const q = filter.trim().toLowerCase();
  const bibles = result?.status === "ok" ? result.bibles.filter((b) => !q || [b.name, b.abbreviation, b.id, b.languageName].some((x) => x.toLowerCase().includes(q))) : [];
  return (
    <div className="space-y-3 rounded-tile border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" loading={pending} loadingText="Asking API.Bible…" onClick={() => start(async () => setResult(await listApiBiblesAction(credential)))}>
          {result?.status === "ok" ? "Refresh list" : "Show the Bibles this key can use"}
        </Button>
        {result?.status === "ok" ? <span className="text-meta text-text-secondary">{result.bibles.length} available</span> : null}
      </div>
      {result && result.status !== "ok" ? <Alert tone="error" title={LIST_PROBLEM[result.reason]} /> : null}
      {result?.status === "ok" ? (
        result.bibles.length ? (
          <>
            {result.bibles.length > 8 ? <TextField label="Filter" name="bible_filter" value={filter} onChange={(e) => setFilter(e.target.value)} optional autoComplete="off" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} /> : null}
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-tile border border-border">
              {bibles.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{b.abbreviation ? `${b.abbreviation} · ` : ""}{b.name}</span>
                    <span className="block break-all text-meta text-text-secondary">{[b.languageName, b.description, b.id].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Button size="sm" variant={chosen === b.id ? "primary" : "ghost"} onClick={() => onPick(b)} aria-pressed={chosen === b.id}>
                    {chosen === b.id ? "Chosen" : "Use this"}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-meta text-text-secondary">This key has no Bibles yet. Add them to the app in your API.Bible dashboard.</p>
        )
      ) : null}
    </div>
  );
}

export function TranslationStatus({ t }: { t: AdminTranslation }) {
  const [state, action] = useActionState(translationStatusAction, initialFormState);
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      {t.status !== "active" ? (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="action" value="activate" />
          <TextField label={`Type ${t.code} to activate`} name="confirm" autoComplete="off" required />
          <SubmitButton size="sm" pendingText="Activating…">
            Activate for members
          </SubmitButton>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!t.is_default ? (
            <form action={action}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="action" value="make_default" />
              <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
                Make the church&apos;s default
              </SubmitButton>
            </form>
          ) : null}
          <form action={action}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="action" value="retire" />
            <SubmitButton size="sm" variant="danger-outline" pendingText="Saving…">
              Retire
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
