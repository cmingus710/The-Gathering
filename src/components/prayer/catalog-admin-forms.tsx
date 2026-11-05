"use client";

import { Archive, ArchiveRestore, CheckCheck, DownloadCloud, EyeOff, ExternalLink, Save, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import {
  archiveCatalogTopicAction,
  catalogStatusAction,
  discardCatalogImportAction,
  importCatalogAction,
  publishAllAction,
  publishLinksAction,
  saveCatalogAction,
} from "@/app/admin/prayer/library/catalogs/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState, type FormState } from "@/lib/forms";
import {
  CATALOG_STATUS_LABEL,
  catalogCount,
  type AdminCatalogDetail,
  type AdminCatalogLink,
  type AdminCatalogTopic,
  type CatalogStatus,
} from "@/lib/prayer/catalog";

/** Runs the pinned import. One button: the dry run decides whether it's enabled. */
export function CatalogImportForm({ disabled, rerun }: { disabled: boolean; rerun: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(() => importCatalogAction(), initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton pendingText="Importing…" disabled={disabled} icon={<DownloadCloud className="size-4" aria-hidden="true" />}>
        {rerun ? "Import again" : "Import the catalogue"}
      </SubmitButton>
      {disabled ? <p className="text-meta text-text-secondary">The dry run must pass before anything can be imported.</p> : null}
    </form>
  );
}

/** Name, description, and the order members see catalogues in. */
export function CatalogDetailsForm({ catalog }: { catalog: AdminCatalogDetail }) {
  const [state, action] = useActionState(saveCatalogAction, initialFormState);
  const fe = state.fieldErrors ?? {};
  const v = state.status === "error" ? (state.values ?? {}) : {};
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="catalogId" value={catalog.id} />
      <TextField
        label="Name"
        name="name"
        required
        minLength={2}
        maxLength={80}
        defaultValue={v.name ?? catalog.name}
        error={fe.name}
        hint="The prayer category members see, for example “Catholic Online Prayers”."
      />
      <TextAreaField
        label="Short description"
        name="description"
        optional
        rows={3}
        maxLength={500}
        defaultValue={v.description ?? catalog.description}
        error={fe.description}
        hint="Shown on the card and at the top of the category. Say where the prayers open."
      />
      <TextField
        label="Order"
        name="sortOrder"
        type="number"
        min={0}
        max={1000000}
        defaultValue={v.sortOrder ?? String(catalog.sort_order)}
        error={fe.sortOrder}
        hint="Lower numbers come first."
      />
      <SubmitButton pendingText="Saving…" icon={<Save className="size-4" aria-hidden="true" />}>
        Save details
      </SubmitButton>
    </form>
  );
}

/**
 * Publish the catalogue to members, put it back to a draft, or archive it.
 * The database refuses to publish one with no published link.
 */
export function CatalogStatusForm({ catalog }: { catalog: AdminCatalogDetail }) {
  const [state, action] = useActionState(catalogStatusAction, initialFormState);
  const next: CatalogStatus[] = catalog.status === "published" ? ["draft", "archived"] : catalog.status === "draft" ? ["published", "archived"] : ["published", "draft"];
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="catalogId" value={catalog.id} />
      <p className="text-meta text-text-secondary">
        Now: <strong className="font-semibold text-text">{CATALOG_STATUS_LABEL[catalog.status]}</strong>.{" "}
        {catalog.counts.published
          ? `${catalogCount(catalog.counts.published)} published of ${catalog.counts.total.toLocaleString("en-US")}.`
          : "No prayer is published yet, so members would see nothing."}
      </p>
      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <SubmitButton
            key={s}
            name="status"
            value={s}
            variant={s === "published" ? "primary" : "secondary"}
            pendingText="Working…"
            icon={s === "archived" ? <Archive className="size-4" aria-hidden="true" /> : s === "draft" ? <EyeOff className="size-4" aria-hidden="true" /> : undefined}
          >
            {s === "published" ? "Publish to members" : s === "draft" ? "Back to a draft" : "Archive"}
          </SubmitButton>
        ))}
      </div>
    </form>
  );
}

/** Publish or unpublish everything in the catalogue, or in one topic. */
export function CatalogPublishAllForm({ catalog, topic }: { catalog: AdminCatalogDetail; topic?: AdminCatalogTopic | null }) {
  const [state, action] = useActionState(publishAllAction, initialFormState);
  const scope = topic ? topic.name : "every prayer in this category";
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="catalogId" value={catalog.id} />
      {topic ? <input type="hidden" name="topicId" value={topic.id} /> : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="publish" value="on" size="sm" pendingText="Publishing…" icon={<CheckCheck className="size-4" aria-hidden="true" />}>
          Publish all
        </SubmitButton>
        <SubmitButton name="publish" value="off" size="sm" variant="secondary" pendingText="Unpublishing…" icon={<EyeOff className="size-4" aria-hidden="true" />}>
          Unpublish all
        </SubmitButton>
      </div>
      <p className="text-meta text-text-secondary">Applies to {scope}. Prayers the source no longer lists stay hidden either way.</p>
    </form>
  );
}

/**
 * The review list: tick the prayers to publish or unpublish, with each one's
 * title, the source's labels, and a link to the page it is on so a reviewer
 * can read it before publishing the link.
 */
export function CatalogReviewForm({ catalogId, items }: { catalogId: string; items: AdminCatalogLink[] }) {
  const [state, action] = useActionState(publishLinksAction, initialFormState);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const count = Object.values(picked).filter(Boolean).length;
  const all = items.length > 0 && count === items.length;

  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="catalogId" value={catalogId} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setPicked(all ? {} : Object.fromEntries(items.map((l) => [l.id, true])))}
        >
          {all ? "Clear this page" : "Select this page"}
        </Button>
        <SubmitButton name="publish" value="on" size="sm" pendingText="Publishing…" disabled={!count} icon={<CheckCheck className="size-4" aria-hidden="true" />}>
          Publish {count || ""}
        </SubmitButton>
        <SubmitButton name="publish" value="off" size="sm" variant="secondary" pendingText="Unpublishing…" disabled={!count} icon={<EyeOff className="size-4" aria-hidden="true" />}>
          Unpublish {count || ""}
        </SubmitButton>
        <p role="status" className="text-meta text-text-secondary">
          {count ? `${count} ticked on this page.` : "Tick the prayers to publish."}
        </p>
      </div>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {items.map((l) => (
          <li key={l.id} className="flex flex-wrap items-start gap-3 p-3">
            <label className="flex min-h-11 min-w-0 flex-1 items-start gap-3">
              <input
                type="checkbox"
                name="link"
                value={l.id}
                checked={!!picked[l.id]}
                onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.checked }))}
                className="mt-1 size-5 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-text [overflow-wrap:anywhere]">{l.title}</span>
                <span className="block text-meta text-text-secondary [overflow-wrap:anywhere]">
                  {l.topics.map((t) => t.name).join(" · ") || "No topic"} · {l.source_id}
                </span>
              </span>
            </label>
            <span className="flex shrink-0 items-center gap-2">
              {l.retired ? (
                <Badge tone="warning" icon={<Trash2 className="size-3.5" aria-hidden="true" />}>
                  No longer listed
                </Badge>
              ) : l.is_published ? (
                <Badge tone="success">Published</Badge>
              ) : (
                <Badge tone="neutral">Not published</Badge>
              )}
              <a
                href={l.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 font-semibold text-primary hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open
                <span className="sr-only"> {l.title} on the source&apos;s site (new tab)</span>
              </a>
            </span>
          </li>
        ))}
      </ul>
    </form>
  );
}

/** Archive or restore one of the source's topics. */
export function CatalogTopicRow({ catalogId, topic }: { catalogId: string; topic: AdminCatalogTopic }) {
  const [state, action] = useActionState(archiveCatalogTopicAction, initialFormState);
  return (
    <div className="flex flex-wrap items-center gap-3 p-3">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-text [overflow-wrap:anywhere]">{topic.name}</span>
        <span className="block text-meta text-text-secondary">
          {topic.published.toLocaleString("en-US")} published of {topic.total.toLocaleString("en-US")}
          {topic.archived ? " · archived" : ""}
        </span>
        {state.status === "error" ? <span className="block text-meta text-danger">{state.message}</span> : null}
      </span>
      <form action={action} className="flex shrink-0 items-center gap-2">
        <input type="hidden" name="catalogId" value={catalogId} />
        <input type="hidden" name="topicId" value={topic.id} />
        <SubmitButton
          name="archived"
          value={topic.archived ? "off" : "on"}
          size="sm"
          variant="ghost"
          pendingText="Working…"
          icon={topic.archived ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
        >
          {topic.archived ? "Restore" : "Archive"}
        </SubmitButton>
      </form>
    </div>
  );
}

/** Discards an import that was left open (nothing it staged is applied). */
export function DiscardCatalogImportForm({ catalogId, importId }: { catalogId: string; importId: string }) {
  return (
    <form action={discardCatalogImportAction}>
      <input type="hidden" name="catalogId" value={catalogId} />
      <input type="hidden" name="importId" value={importId} />
      <SubmitButton size="sm" variant="ghost" pendingText="Discarding…" icon={<Trash2 className="size-4" aria-hidden="true" />}>
        Discard it
      </SubmitButton>
    </form>
  );
}
