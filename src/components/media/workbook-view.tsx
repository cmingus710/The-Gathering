/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { BookOpen, Download, ExternalLink, FileText, Lock } from "lucide-react";
import Link from "next/link";
import { MarkdownBody } from "@/components/announcements/markdown-body";
import { FumsTracker } from "@/components/bible/fums";
import { Attribution, ScriptureText } from "@/components/bible/scripture";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatBytes } from "@/lib/media/files";
import { formatDay } from "@/lib/media/format";
import { acceptQuestionChangeAction, deleteAnswerAction, deleteWorkbookAction } from "@/lib/media/workbook-actions";
import type { WorkbookPage } from "@/lib/media/workbook-page";
import type { BlockAsset, WorkbookAnswer, WorkbookBlock } from "@/lib/media/workbook";
import { AudioCard } from "./audio-card";
import { VideoPlayer } from "./video-player";
import { WorkbookText } from "./workbook-text";

export const PRIVACY_COPY = "Your answers are private. Teachers and administrators can't see them.";

function MediaBlock({ asset, itemId, title }: { asset: BlockAsset; itemId: string; title: string }) {
  if (asset.kind === "external_video" || asset.kind === "video") {
    return (
      <VideoPlayer
        title={title}
        itemId={itemId}
        video={{
          asset_id: asset.asset_id,
          kind: asset.kind,
          title: asset.title,
          provider: asset.provider,
          provider_ref: asset.provider_ref,
          provider_hash: asset.provider_hash,
          duration_seconds: asset.duration_seconds,
          width: null,
          height: null,
          has_thumb: asset.kind === "external_video" && asset.provider === "youtube",
          unavailable: false,
          attribution: asset.attribution,
          captions: asset.captions,
        }}
      />
    );
  }
  if (asset.kind === "audio") {
    return (
      <AudioCard
        track={{
          key: `a:${asset.asset_id}`,
          itemId,
          src: `/api/media/${asset.asset_id}/play`,
          title,
          subtitle: "Sunday lesson",
          duration: asset.duration_seconds,
          captions: asset.captions.map((c) => ({ src: `/api/media/${c.asset_id}/vtt`, label: c.label, language: c.language })),
          saveProgress: false,
        }}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
      <FileText className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{asset.title}</span>
        <span className="block text-meta text-text-secondary">{[asset.mime === "application/pdf" ? "PDF" : "Document", asset.size_bytes ? formatBytes(asset.size_bytes) : null].filter(Boolean).join(" · ")}</span>
      </span>
      {asset.mime === "application/pdf" ? (
        <a href={`/api/media/${asset.asset_id}/file`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
          Open <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only">{asset.title} (opens a new tab)</span>
        </a>
      ) : null}
      <a href={`/api/media/${asset.asset_id}/file?download=1`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
        <Download className="size-4" aria-hidden="true" /> Download<span className="sr-only"> {asset.title}</span>
      </a>
    </div>
  );
}

function Changed({ answer, itemId, preview }: { answer: WorkbookAnswer; itemId: string; preview: boolean }) {
  return (
    <div className="rounded-tile border border-primary bg-primary-soft px-3 py-2 text-meta">
      <p className="font-semibold">The question changed after you answered.</p>
      <p className="mt-1">
        You answered: <q className="italic">{answer.prompt_snapshot}</q>
      </p>
      {!preview ? (
        <form action={acceptQuestionChangeAction} className="mt-2">
          <input type="hidden" name="item" value={itemId} />
          <input type="hidden" name="block" value={answer.block_id} />
          <Button type="submit" size="sm" variant="secondary">
            Keep my answer for the new question
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function Block({ block, page, userId, index }: { block: WorkbookBlock; page: WorkbookPage; userId: string | null; index: number }) {
  const { workbook } = page;
  const itemId = workbook.lesson?.id ?? "";
  const answer = workbook.answers.find((a) => a.block_id === block.id) ?? null;
  const headingId = `block-${block.id}`;
  const heading = block.heading ?? (block.kind === "scripture" ? block.scripture_ref : null);
  const Tag = block.kind === "title_intro" ? "h2" : "h3";
  return (
    <section aria-labelledby={heading ? headingId : undefined} aria-label={heading ? undefined : `Part ${index + 1}`} className="space-y-3">
      {heading ? (
        <Tag id={headingId} className={block.kind === "title_intro" ? "font-display text-title font-semibold" : "text-lg font-semibold"}>
          {heading}
        </Tag>
      ) : null}

      {block.kind === "scripture" && block.scripture_ref ? <ScriptureBlock block={block} page={page} /> : null}

      {block.body.trim() ? <MarkdownBody source={block.body} className="reading-body" /> : null}

      {block.kind === "image" && block.asset ? (
        <figure className="space-y-2">
          {page.urls.get(block.asset.variant_path ?? block.asset.path ?? "") ? (
            <img
              src={page.urls.get(block.asset.variant_path ?? block.asset.path ?? "")}
              alt={block.asset.alt}
              width={block.asset.width ?? undefined}
              height={block.asset.height ?? undefined}
              className="max-h-[28rem] w-full rounded-card object-contain"
            />
          ) : (
            <p className="text-meta text-text-secondary">This image isn&apos;t available right now.</p>
          )}
          {block.caption ? <figcaption className="text-meta text-text-secondary">{block.caption}</figcaption> : null}
        </figure>
      ) : null}

      {block.kind === "media" && block.asset ? (
        <div className="space-y-2">
          <MediaBlock asset={block.asset} itemId={itemId} title={block.heading ?? block.asset.title} />
          {block.caption ? <p className="text-meta text-text-secondary">{block.caption}</p> : null}
        </div>
      ) : null}
      {(block.kind === "image" || block.kind === "media") && !block.asset ? (
        <p className="text-meta text-text-secondary">This file isn&apos;t available right now.</p>
      ) : null}

      {block.answerable && block.prompt ? (
        <div className="space-y-2 rounded-card border border-border bg-surface p-4">
          <p className="font-semibold" id={`${headingId}-prompt`}>
            {block.prompt}
          </p>
          {answer?.state === "changed" ? <Changed answer={answer} itemId={itemId} preview={workbook.preview} /> : null}
          {workbook.preview || !userId ? (
            <textarea
              disabled
              rows={4}
              aria-label={`Answer: ${block.prompt}`}
              placeholder="Members write their private answer here."
              className="block w-full rounded-control border border-border bg-surface-muted px-4 py-3 text-base"
            />
          ) : (
            <WorkbookText
              userId={userId}
              itemId={itemId}
              slot={block.id}
              url={`/api/workbook/${itemId}/answers/${block.id}`}
              initial={answer ? { body: answer.body, version: answer.version, updated_at: answer.updated_at } : null}
              label={`Your answer: ${block.prompt}`}
              labelHidden
            />
          )}
        </div>
      ) : null}
    </section>
  );
}

function ScriptureBlock({ block, page }: { block: WorkbookBlock; page: WorkbookPage }) {
  const s = page.scripture[block.id];
  const ref = block.scripture_ref!;
  return (
    <details className="rounded-card border border-border bg-surface p-4" open={page.workbook.preview || undefined}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-primary">
        <BookOpen className="size-4" aria-hidden="true" />
        Read {ref}
        {s?.status === "ok" ? <span className="text-meta text-text-secondary">({s.translation.code})</span> : null}
      </summary>
      <div className="mt-3 space-y-4">
        {!s || s.status === "unavailable" ? (
          <p className="text-meta text-text-secondary">
            {s?.reason ?? "This passage can't be shown here."}{" "}
            <Link href={s?.status === "unavailable" && s.link ? s.link : "/bible"} className="font-semibold text-primary hover:underline">
              Open {ref} in the Bible reader
            </Link>
          </p>
        ) : (
          <>
            {s.passages.map((p, i) => (
              <div key={i}>
                {s.passages.length > 1 ? <p className="mb-1 text-meta font-semibold">{p.label}</p> : null}
                <ScriptureText verses={p.verses} translation={s.translation} showChapters={p.multiChapter} label={`${p.label}, ${s.translation.code}`} />
              </div>
            ))}
            <p className="text-meta">
              <Link href={`/bible/read/${s.translation.code}/${s.passages[0].book}/${s.passages[0].chapter}`} className="font-semibold text-primary hover:underline">
                Read the whole chapter
              </Link>
            </p>
            {s.copyright ? <p className="text-meta text-text-secondary">{s.copyright}</p> : null}
          </>
        )}
      </div>
    </details>
  );
}

/**
 * The workbook page body, shared by the member page and the editor's
 * preview (which passes the same member projection, no answers).
 */
export function WorkbookView({ page, userId }: { page: WorkbookPage; userId: string | null; /** Unused since the shared video player. */ origin?: string }) {
  const { workbook } = page;
  const lesson = workbook.lesson;
  const removed = workbook.answers.filter((a) => a.state === "removed");
  const itemId = lesson?.id ?? "";
  const speakers = lesson?.people.filter((p) => p.role !== "contributor").map((p) => p.name) ?? [];

  if (!workbook.available || !lesson) return null;

  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <p className="text-meta font-semibold text-text-secondary">
          Sunday lesson workbook · <time dateTime={lesson.delivered_on}>{formatDay(lesson.delivered_on, "long")}</time>
        </p>
        <h1 className="font-display text-display font-semibold leading-tight">{lesson.title}</h1>
        {speakers.length ? <p className="text-text-secondary">{speakers.join(", ")}</p> : null}
        <p className="flex items-center gap-1.5 text-meta font-semibold">
          <Lock className="size-4 text-primary" aria-hidden="true" />
          {PRIVACY_COPY}
        </p>
      </header>

      {workbook.blocks.length ? (
        workbook.blocks.map((b, i) => <Block key={b.id} block={b} page={page} userId={userId} index={i} />)
      ) : (
        <Alert tone="info" title="This lesson has no workbook yet.">
          You can still keep private notes below.
        </Alert>
      )}

      {page.translations.map((t) => (
        <Attribution key={t.id} translation={t} />
      ))}

      <section aria-labelledby="wb-notes" className="space-y-2">
        <SectionHeading id="wb-notes" description="Anything else you want to remember from this lesson. Only you can see it.">
          My notes
        </SectionHeading>
        {workbook.preview || !userId ? (
          <textarea disabled rows={4} aria-label="My notes" placeholder="Members keep private notes here." className="block w-full rounded-control border border-border bg-surface-muted px-4 py-3 text-base" />
        ) : (
          <WorkbookText
            userId={userId}
            itemId={itemId}
            slot="note"
            url={`/api/workbook/${itemId}/note`}
            initial={workbook.note ? { body: workbook.note.body, version: workbook.note.version, updated_at: workbook.note.updated_at } : null}
            label="My notes"
            labelHidden
            placeholder="Write anything. Only you can see it."
            rows={6}
          />
        )}
      </section>

      {removed.length ? <RemovedAnswers answers={removed} itemId={itemId} /> : null}

      {!workbook.preview && userId && (workbook.answers.length || workbook.note) ? (
        <section aria-labelledby="wb-delete" className="space-y-2 border-t border-border pt-6">
          <h2 id="wb-delete" className="font-semibold">
            Delete my answers
          </h2>
          <p className="text-meta text-text-secondary">Removes every answer and note you wrote for this lesson. This can&apos;t be undone.</p>
          <ConfirmDialog trigger="Delete my answers" title="Delete your answers and notes for this lesson?" confirmLabel="Delete" formAction={deleteWorkbookAction} hidden={{ item: itemId }}>
            Your answers and notes for this lesson are removed. The lesson itself isn&apos;t affected.
          </ConfirmDialog>
        </section>
      ) : null}
      <FumsTracker ids={page.fums} />
    </article>
  );
}

/** Answers to questions that are no longer part of the lesson (kept for their author). */
export function RemovedAnswers({ answers, itemId }: { answers: WorkbookAnswer[]; itemId: string }) {
  return (
    <section aria-labelledby="wb-removed" className="space-y-3">
      <SectionHeading id="wb-removed" description="These questions were removed from the lesson after you answered. Your answers are kept here for you.">
        Removed questions
      </SectionHeading>
      <ul className="space-y-3">
        {answers.map((a) => (
          <li key={a.block_id} className="rounded-card border border-border bg-surface p-4">
            <p className="font-semibold">{a.prompt_snapshot || "A question"}</p>
            <p className="mt-2 whitespace-pre-wrap">{a.body || <span className="text-text-secondary">(no answer written)</span>}</p>
            <form action={deleteAnswerAction} className="mt-2">
              <input type="hidden" name="item" value={itemId} />
              <input type="hidden" name="block" value={a.block_id} />
              <Button type="submit" size="sm" variant="ghost">
                Delete this answer
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
