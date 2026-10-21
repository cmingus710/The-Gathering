"use client";

import { ArrowDown, ArrowUp, Lock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { ANSWERABLE, BLOCK_KINDS, BLOCK_LABEL, checkScriptureRef, type AdminBlock, type BlockKind, type BuilderPayload } from "@/lib/media/workbook";
import type { AssetChoice } from "../../editor-data";
import { removeBlockAction, reorderBlocksAction, restoreBlockAction, saveBlockAction, type BlockInput } from "./actions";

type Fields = Omit<BlockInput, "id" | "client_key" | "kind">;

type Row = {
  key: string;
  kind: BlockKind;
  /** The saved block (null until the first save). */
  saved: AdminBlock | null;
  clientKey: string | null;
  fields: Fields;
  busy: boolean;
  error: string | null;
  refError: string | null;
  /** Someone else's newer version, when a save was refused. */
  conflict: AdminBlock | null;
};

const fieldsOf = (b: AdminBlock): Fields => ({
  heading: b.heading ?? "",
  body: b.body,
  prompt: b.prompt ?? "",
  scripture_ref: b.scripture_ref ?? "",
  asset_id: b.asset_id ?? "",
  caption: b.caption ?? "",
  alt_text: b.alt_text ?? "",
  teacher_only: b.teacher_only,
  teacher_note: b.teacher_note,
});

const EMPTY: Fields = { heading: "", body: "", prompt: "", scripture_ref: "", asset_id: "", caption: "", alt_text: "", teacher_only: false, teacher_note: "" };

const rowOf = (b: AdminBlock): Row => ({ key: b.id, kind: b.kind, saved: b, clientKey: null, fields: fieldsOf(b), busy: false, error: null, refError: null, conflict: null });

function sameFields(a: Fields, b: Fields) {
  return (Object.keys(a) as Array<keyof Fields>).every((k) => (typeof a[k] === "string" ? (a[k] as string).trim() === String(b[k]).trim() : a[k] === b[k]));
}

const isDirty = (r: Row) => !r.saved || !sameFields(r.fields, fieldsOf(r.saved));

const assetLabel = (a: AssetChoice) => `${a.title}${a.kind === "external_video" ? (a.provider === "vimeo" ? " (Vimeo)" : " (YouTube)") : a.kind === "document" ? " (document)" : a.kind === "audio" ? " (audio)" : a.kind === "video" ? " (video)" : ""}`;

const HAS_BODY: ReadonlySet<BlockKind> = new Set(["title_intro", "scripture", "teaching", "discussion", "response", "illustration", "reflection", "closing"]);

/**
 * The lesson builder: ordered blocks, each saved on its own against the
 * revision it was edited from. Moving a block changes its position only;
 * its identity (and members' answers to it) never changes.
 */
export function LessonBuilder({ payload, assets }: { payload: BuilderPayload; assets: { image: AssetChoice[]; media: AssetChoice[] } }) {
  const itemId = payload.lesson.id;
  const [rows, setRows] = useState<Row[]>(() => payload.blocks.map(rowOf));
  const [removed, setRemoved] = useState<AdminBlock[]>(payload.removed);
  const [newKind, setNewKind] = useState<BlockKind>("teaching");
  const [listError, setListError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [, startTransition] = useTransition();
  const readOnly = !payload.can_edit;
  const live = payload.lesson.status !== "draft";
  const dirtyCount = useMemo(() => rows.filter(isDirty).length, [rows]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyCount > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirtyCount]);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const setField = (key: string, f: Partial<Fields>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, fields: { ...r.fields, ...f } } : r)));

  const add = () => {
    const key = crypto.randomUUID();
    setRows((rs) => [...rs, { key, kind: newKind, saved: null, clientKey: key, fields: { ...EMPTY }, busy: false, error: null, refError: null, conflict: null }]);
    setAnnounce(`${BLOCK_LABEL[newKind]} block added at the end. It isn't saved yet.`);
    requestAnimationFrame(() => document.getElementById(`block-${key}`)?.focus());
  };

  const save = (row: Row, base: number | null) => {
    if (row.kind === "scripture") {
      const r = checkScriptureRef(row.fields.scripture_ref);
      if (!r.ok) {
        patch(row.key, { refError: r.error, error: "Fix the scripture reference, then save." });
        return;
      }
    }
    patch(row.key, { busy: true, error: null });
    startTransition(async () => {
      const result = await saveBlockAction(
        itemId,
        { id: row.saved?.id ?? null, client_key: row.saved ? null : row.clientKey, kind: row.kind, ...row.fields },
        base,
      ).catch(() => ({ ok: false as const, error: "The connection was interrupted. Your changes are still here; try again." }));
      if (!result.ok) {
        patch(row.key, { busy: false, error: result.error });
        return;
      }
      if (result.status === "conflict") {
        patch(row.key, { busy: false, conflict: result.current, error: null });
        return;
      }
      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, saved: result.block, fields: fieldsOf(result.block), busy: false, conflict: null, error: null, refError: null } : r)));
      setAnnounce(`${BLOCK_LABEL[row.kind]} block saved.`);
    });
  };

  const remove = (row: Row) => {
    if (!row.saved) {
      setRows((rs) => rs.filter((r) => r.key !== row.key));
      setAnnounce("Unsaved block discarded.");
      return;
    }
    patch(row.key, { busy: true, error: null });
    startTransition(async () => {
      const result = await removeBlockAction(itemId, row.saved!.id, row.saved!.revision).catch(() => ({ ok: false as const, error: "The connection was interrupted. Try again." }));
      if (!result.ok) return patch(row.key, { busy: false, error: result.error });
      if (result.status === "conflict") return patch(row.key, { busy: false, conflict: result.current });
      setRows((rs) => rs.filter((r) => r.key !== row.key));
      setRemoved((rm) => [result.block, ...rm]);
      setAnnounce(`${BLOCK_LABEL[row.kind]} block removed. Members' answers to it are kept for them.`);
    });
  };

  const restore = (b: AdminBlock) => {
    startTransition(async () => {
      const result = await restoreBlockAction(itemId, b.id).catch(() => ({ ok: false as const, error: "The connection was interrupted. Try again." }));
      if (!result.ok) return setListError(result.error);
      if (result.status === "conflict") return;
      setRemoved((rm) => rm.filter((x) => x.id !== b.id));
      setRows((rs) => {
        const saved = rs.filter((r) => r.saved);
        const unsaved = rs.filter((r) => !r.saved);
        return [...saved, rowOf(result.block), ...unsaved];
      });
      setAnnounce(`${BLOCK_LABEL[b.kind]} block restored at the end.`);
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length || !rows[index].saved || !rows[target].saved) return;
    const before = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    setListError(null);
    const key = rows[index].key;
    requestAnimationFrame(() => {
      const button = document.getElementById(`move-${dir < 0 ? "up" : "down"}-${key}`) as HTMLButtonElement | null;
      (button && !button.disabled ? button : document.getElementById(`move-${dir < 0 ? "down" : "up"}-${key}`))?.focus();
    });
    setAnnounce(`Moved to position ${target + 1} of ${rows.length}.`);
    startTransition(async () => {
      const result = await reorderBlocksAction(
        itemId,
        next.filter((r) => r.saved).map((r) => r.saved!.id),
      ).catch(() => ({ ok: false, conflict: false, error: "The connection was interrupted. The order wasn't saved." }));
      if (!result.ok) {
        setRows(before);
        setListError(result.conflict ? "Someone else added or removed blocks meanwhile, so the new order wasn't saved. Save your open changes, then reload the page." : (result.error ?? "The order couldn't be saved."));
      }
    });
  };

  return (
    <div className="space-y-6">
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {readOnly ? (
        <Alert tone="warning" title="This lesson is scheduled, published, or archived.">
          Only a content publisher can change its blocks. You can still preview the member workbook.
        </Alert>
      ) : live ? (
        <Alert tone="info" title="This lesson is live.">
          Saved changes reach members at once. Changing a question&apos;s wording shows members who already answered that the question changed, with
          their original question. Removing a block keeps members&apos; answers for them.
        </Alert>
      ) : null}
      {dirtyCount ? (
        <p className="text-meta font-semibold" role="status">
          {dirtyCount} block{dirtyCount === 1 ? " has" : "s have"} unsaved changes.
        </p>
      ) : null}
      {listError ? <Alert tone="error" title={listError} /> : null}

      {rows.length ? null : <p className="text-text-secondary">No blocks yet. Add the first one below.</p>}

      <ol className="space-y-4">
        {rows.map((row, i) => {
          const dirty = isDirty(row);
          const f = row.fields;
          const pid = row.key;
          const answerable = ANSWERABLE.has(row.kind);
          return (
            <li key={row.key}>
              <fieldset
                id={`block-${row.key}`}
                tabIndex={-1}
                disabled={readOnly}
                aria-labelledby={`legend-${pid}`}
                className={cn("space-y-4 rounded-card border bg-surface p-4 sm:p-5", f.teacher_only ? "border-dashed border-accent bg-surface-muted" : "border-border", dirty && "ring-2 ring-primary/40")}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id={`legend-${pid}`} className="font-semibold">
                    {i + 1}. {BLOCK_LABEL[row.kind]}
                    {row.fields.heading ? `: ${row.fields.heading}` : ""}
                  </h2>
                  {f.teacher_only ? (
                    <Badge tone="warning" icon={<Lock className="size-3.5" aria-hidden="true" />}>
                      Teacher only — never shown to members
                    </Badge>
                  ) : null}
                  {!row.saved ? <Badge tone="info">New, not saved</Badge> : dirty ? <Badge tone="info">Unsaved changes</Badge> : <Badge tone="success">Saved</Badge>}
                  <span className="flex-1" />
                  <Button
                    id={`move-up-${row.key}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || !row.saved || !rows[i - 1]?.saved}
                    aria-label={`Move block ${i + 1} up`}
                    icon={<ArrowUp className="size-4" aria-hidden="true" />}
                  >
                    <span className="sr-only sm:not-sr-only">Up</span>
                  </Button>
                  <Button
                    id={`move-down-${row.key}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1 || !row.saved || !rows[i + 1]?.saved}
                    aria-label={`Move block ${i + 1} down`}
                    icon={<ArrowDown className="size-4" aria-hidden="true" />}
                  >
                    <span className="sr-only sm:not-sr-only">Down</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(row)} disabled={row.busy} aria-label={`Remove block ${i + 1}`} icon={<Trash2 className="size-4" aria-hidden="true" />}>
                    <span className="sr-only sm:not-sr-only">Remove</span>
                  </Button>
                </div>

                {row.conflict ? (
                  <Alert tone="warning" title="Someone else saved this block while you were editing.">
                    <p>
                      {row.conflict.updated_by_name ? `${row.conflict.updated_by_name} saved it. ` : ""}Your changes are still here. Their version:
                    </p>
                    <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-tile border border-border bg-surface p-2 text-meta">
                      {[row.conflict.heading, row.conflict.prompt, row.conflict.scripture_ref, row.conflict.body].filter(Boolean).join("\n\n") || "(no text)"}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => save(row, row.conflict!.revision)}>
                        Keep mine (save over theirs)
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => patch(row.key, { saved: row.conflict, fields: fieldsOf(row.conflict!), conflict: null })}>
                        Use their version
                      </Button>
                    </div>
                  </Alert>
                ) : null}

                <TextField label="Heading" name={`heading-${pid}`} id={`heading-${pid}`} maxLength={200} value={f.heading} onChange={(e) => setField(row.key, { heading: e.target.value })} optional />

                {row.kind === "scripture" ? (
                  <TextField
                    label="Scripture reference"
                    name={`ref-${pid}`}
                    id={`ref-${pid}`}
                    value={f.scripture_ref}
                    maxLength={80}
                    required
                    onChange={(e) => setField(row.key, { scripture_ref: e.target.value })}
                    onBlur={() => {
                      if (!f.scripture_ref.trim()) return;
                      const r = checkScriptureRef(f.scripture_ref);
                      if (r.ok) {
                        setField(row.key, { scripture_ref: r.ref });
                        patch(row.key, { refError: null });
                      } else patch(row.key, { refError: r.error });
                    }}
                    error={row.refError ?? undefined}
                    hint="For example John 3:16–18 or Psalm 23. Members see the text in their Bible version, within its license limits."
                  />
                ) : null}

                {answerable ? (
                  <TextAreaField
                    label="Question members answer"
                    name={`prompt-${pid}`}
                    id={`prompt-${pid}`}
                    rows={2}
                    maxLength={1000}
                    required
                    value={f.prompt}
                    onChange={(e) => setField(row.key, { prompt: e.target.value })}
                    hint={live && row.saved ? "Changing the wording tells members who already answered that the question changed." : "Members' answers are private: teachers and administrators can't see them."}
                  />
                ) : null}

                {row.kind === "image" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField label="Image" name={`asset-${pid}`} id={`asset-${pid}`} value={f.asset_id} onChange={(e) => setField(row.key, { asset_id: e.target.value })}>
                      <option value="">Choose…</option>
                      {assets.image.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </SelectField>
                    <TextField label="Image description" name={`alt-${pid}`} id={`alt-${pid}`} maxLength={500} value={f.alt_text} onChange={(e) => setField(row.key, { alt_text: e.target.value })} optional hint="For screen readers. Leave empty to use the library's description." />
                  </div>
                ) : null}
                {row.kind === "media" ? (
                  <SelectField label="File" name={`asset-${pid}`} id={`asset-${pid}`} value={f.asset_id} onChange={(e) => setField(row.key, { asset_id: e.target.value })} hint="Audio, video (including YouTube or Vimeo videos added to the library), or a document.">
                    <option value="">Choose…</option>
                    {assets.media.map((a) => (
                      <option key={a.id} value={a.id}>
                        {assetLabel(a)}
                      </option>
                    ))}
                  </SelectField>
                ) : null}
                {(row.kind === "image" || row.kind === "media") && row.saved?.asset && row.saved.asset.status !== "ready" ? (
                  <p className="text-meta text-danger">The chosen file isn&apos;t available any more ({row.saved.asset.title}). Choose another.</p>
                ) : null}
                {row.kind === "image" || row.kind === "media" ? (
                  <TextField label="Caption" name={`caption-${pid}`} id={`caption-${pid}`} maxLength={500} value={f.caption} onChange={(e) => setField(row.key, { caption: e.target.value })} optional />
                ) : null}

                {HAS_BODY.has(row.kind) ? (
                  <TextAreaField
                    label={answerable ? "Text before the question" : "Text"}
                    name={`body-${pid}`}
                    id={`body-${pid}`}
                    rows={row.kind === "teaching" ? 8 : 4}
                    maxLength={20000}
                    value={f.body}
                    onChange={(e) => setField(row.key, { body: e.target.value })}
                    optional={row.kind !== "teaching"}
                    hint="Formatting: **bold**, *italic*, ## heading, - list, [link text](https://…). HTML isn't allowed."
                  />
                ) : null}

                <div className="space-y-3 rounded-tile border border-dashed border-accent bg-surface-muted p-3">
                  <p className="flex items-center gap-1.5 text-meta font-semibold">
                    <Lock className="size-4 text-accent" aria-hidden="true" />
                    Teacher only — never shown to members
                  </p>
                  <CheckboxField
                    name={`teacher-only-${pid}`}
                    id={`teacher-only-${pid}`}
                    label="Hide this whole block from members"
                    hint={answerable ? "Members who already answered keep their answer, listed under Removed questions." : "Only teachers see it, here and in the lesson builder."}
                    checked={f.teacher_only}
                    onChange={(e) => setField(row.key, { teacher_only: e.target.checked })}
                  />
                  <TextAreaField
                    label="Teacher note"
                    name={`note-${pid}`}
                    id={`note-${pid}`}
                    rows={3}
                    maxLength={10000}
                    value={f.teacher_note}
                    onChange={(e) => setField(row.key, { teacher_note: e.target.value })}
                    optional
                    hint="Leader prompts, timing, background. Never included in anything members receive, including the preview."
                  />
                </div>

                {row.error ? (
                  <p role="alert" className="text-meta font-semibold text-danger">
                    {row.error}
                  </p>
                ) : null}
                {!readOnly ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => save(row, row.saved?.revision ?? null)} loading={row.busy} loadingText="Saving…" disabled={!dirty || !!row.conflict}>
                      {row.saved ? "Save block" : "Save new block"}
                    </Button>
                    {row.saved && dirty ? (
                      <Button size="sm" variant="ghost" onClick={() => patch(row.key, { fields: fieldsOf(row.saved!), error: null, refError: null })} icon={<RotateCcw className="size-4" aria-hidden="true" />}>
                        Discard changes
                      </Button>
                    ) : null}
                    {row.saved ? (
                      <span className="text-meta text-text-secondary">
                        Revision {row.saved.revision}
                        {row.saved.updated_by_name ? ` · last saved by ${row.saved.updated_by_name}` : ""}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>
            </li>
          );
        })}
      </ol>

      {!readOnly ? (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-4">
          <SelectField label="Add a block" name="new-kind" id="new-kind" value={newKind} onChange={(e) => setNewKind(e.target.value as BlockKind)} className="min-w-64">
            {BLOCK_KINDS.map((k) => (
              <option key={k} value={k}>
                {BLOCK_LABEL[k]}
              </option>
            ))}
          </SelectField>
          <Button variant="secondary" onClick={add} icon={<Plus className="size-4" aria-hidden="true" />} disabled={rows.length >= 100}>
            Add block
          </Button>
        </div>
      ) : null}

      {removed.length ? (
        <section aria-labelledby="removed-blocks" className="space-y-2">
          <h2 id="removed-blocks" className="text-lg font-semibold">
            Removed blocks
          </h2>
          <p className="text-meta text-text-secondary">Members&apos; answers to removed questions are kept for them. Restoring a block brings it back with the same identity.</p>
          <ul className="space-y-2">
            {removed.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-tile border border-border bg-surface px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{BLOCK_LABEL[b.kind]}</span>
                  <span className="text-text-secondary"> · {b.heading ?? b.prompt ?? b.scripture_ref ?? (b.body.slice(0, 80) || "no text")}</span>
                </span>
                {!readOnly ? (
                  <Button size="sm" variant="ghost" onClick={() => restore(b)}>
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
