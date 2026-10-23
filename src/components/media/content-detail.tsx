/* eslint-disable @next/next/no-img-element -- short-lived signed URLs, never through the image optimizer */
import { BookOpen, Download, ExternalLink, FileText, MessagesSquare, NotebookPen } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { MarkdownBody } from "@/components/announcements/markdown-body";
import { Alert } from "@/components/ui/alert";
import { SectionHeading } from "@/components/ui/card";
import { formatBytes } from "@/lib/media/files";
import { formatDay, itemDate, itemHref, KIND_LABEL, speakers } from "@/lib/media/format";
import { spotifyEmbed } from "@/lib/media/embeds";
import { parseFraming } from "@/lib/media/framing";
import { videoAttachments } from "@/lib/media/videos";
import type { Attachment, ItemDetail } from "@/lib/media/types";
import { AudioCard } from "./audio-card";
import { BookAccess } from "./book-access";
import { EmbedPlayer } from "./embed-player";
import { FramedImage } from "./framed-image";
import { ItemCard, itemCover } from "./item-card";
import { BookmarkButton, CompleteToggle } from "./toggles";
import { VideoList } from "./video-list";
import { VideoUsedIn } from "./video-card";

const QUESTION_TITLE: Record<string, string> = { devotional: "Reflection questions", assignment: "Discussion questions" };

export function FileRow({ a }: { a: Attachment }) {
  const ext = a.mime?.includes("presentation") ? "PowerPoint" : a.mime === "application/pdf" ? "PDF" : a.kind === "audio" ? "Audio" : "File";
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <FileText className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{a.label}</span>
        <span className="block text-meta text-text-secondary">
          {[a.role === "slides" ? "Slides" : a.role === "handout" ? "Handout" : "Resource", ext, a.size_bytes ? formatBytes(a.size_bytes) : null].filter(Boolean).join(" · ")}
        </span>
      </span>
      {a.kind === "document" ? (
        <span className="flex gap-1">
          {a.mime === "application/pdf" ? (
            <a href={`/api/media/${a.asset_id}/file`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
              Open <ExternalLink className="size-4" aria-hidden="true" />
              <span className="sr-only">{a.label} (opens a new tab)</span>
            </a>
          ) : null}
          <a href={`/api/media/${a.asset_id}/file?download=1`} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 font-semibold text-primary hover:bg-primary-soft">
            <Download className="size-4" aria-hidden="true" /> Download<span className="sr-only"> {a.label}</span>
          </a>
        </span>
      ) : null}
    </li>
  );
}

export function ContentDetail({
  item,
  urls,
  transcripts,
  member,
  preview = false,
  book,
}: {
  item: ItemDetail;
  urls: Map<string, string>;
  transcripts: Record<string, string>;
  member: boolean;
  /** Unused since the shared video player (kept so existing pages compile unchanged). */
  origin?: string;
  preview?: boolean;
  /** Phase 13 book extras (Kindle link and the member's reading panel), rendered after "Read or listen". */
  book?: { kindleUrl: string | null; panel?: ReactNode };
}) {
  const day = itemDate(item);
  const byline = speakers(item);
  const videos = videoAttachments(item.attachments);
  const video = videos[0];
  const audio = item.attachments.find((a) => a.role === "audio");
  const files = item.attachments.filter((a) => a.role !== "audio" && a.role !== "video");
  const cover = itemCover(item, urls, "large");
  const withTranscript = item.attachments.filter((a) => a.has_transcript && transcripts[a.asset_id]);
  const contributors = item.people.filter((p) => p.role === "contributor").map((p) => p.name);

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <p className="text-meta font-semibold text-text-secondary">
          {KIND_LABEL[item.kind]}
          {day && item.kind !== "book" && item.kind !== "playlist" ? (
            <>
              {" · "}
              <time dateTime={day}>{formatDay(day, item.kind === "devotional" ? "weekday" : "long")}</time>
            </>
          ) : null}
          {item.kind === "assignment" && item.ends_on ? ` – ${formatDay(item.ends_on, "short")}` : ""}
        </p>
        <h1 className="font-display text-display font-semibold leading-tight text-text sm:text-[2.125rem]">{item.title}</h1>
        {byline || item.book_author ? <p className="text-text-secondary">{item.kind === "book" ? `by ${item.book_author}` : byline}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {item.series ? (
            <Link href={`/lessons/series/${item.series.id}`} className="rounded-full border border-border bg-surface px-3 py-1 text-meta font-semibold hover:bg-surface-muted">
              Series: {item.series.title}
            </Link>
          ) : null}
          {item.show ? (
            <Link href={`/podcasts/shows/${item.show.id}`} className="rounded-full border border-border bg-surface px-3 py-1 text-meta font-semibold hover:bg-surface-muted">
              {item.show.title}
            </Link>
          ) : null}
          {item.book ? (
            <Link href={`/reading/books/${item.book.id}`} className="rounded-full border border-border bg-surface px-3 py-1 text-meta font-semibold hover:bg-surface-muted">
              {item.book.title}
            </Link>
          ) : null}
          {item.group_name ? <span className="rounded-full bg-surface-muted px-3 py-1 text-meta">For {item.group_name}</span> : null}
          {member && !preview ? <BookmarkButton type="item" id={item.id} saved={item.bookmarked} label={item.title} /> : null}
          {/* Phase 8: a private journal note about this devotional or lesson (never posted anywhere). */}
          {member && !preview && (item.kind === "devotional" || item.kind === "lesson" || item.kind === "book") ? (
            <Link href={`/journal/new?item=${item.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-meta font-semibold hover:bg-surface-muted">
              <NotebookPen className="size-4" aria-hidden="true" />
              Write privately
            </Link>
          ) : null}
        </div>
        {item.scripture_refs.length ? (
          <ul aria-label="Scripture" className="flex flex-wrap gap-1.5">
            {item.scripture_refs.map((r) => (
              <li key={r} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-meta font-semibold text-primary">
                <BookOpen className="size-3.5" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {cover && !video ? (
        item.kind === "book" ? (
          // The whole portrait cover, never cropped to a landscape strip.
          <img src={cover} alt={item.cover?.alt ?? ""} className="max-h-[28rem] w-auto max-w-full rounded-card object-contain" />
        ) : item.cover?.framing ? (
          // Positioned for this item in the editor's 16:9 frame.
          <FramedImage src={cover} alt={item.cover.alt ?? ""} framing={parseFraming(item.cover.framing)} className="aspect-[16/9] w-full rounded-card" />
        ) : (
          <img src={cover} alt={item.cover?.alt ?? ""} className="max-h-[28rem] w-full rounded-card object-cover" />
        )
      ) : null}

      {videos.length ? (
        <section aria-label={videos.length > 1 ? "Videos" : "Video"}>
          <VideoList
            attachments={item.attachments}
            title={item.title}
            itemId={item.id}
            poster={cover}
            progress={item.progress}
            saveProgress={member && !preview}
          />
        </section>
      ) : null}

      {item.kind === "video" && item.used_in?.length ? <VideoUsedIn uses={item.used_in} /> : null}

      {audio ? (
        <AudioCard
          label={item.kind === "episode" ? "Listen to this episode" : "Listen"}
          resumeAt={item.progress[`a:${audio.asset_id}`]?.position}
          track={{
            key: `a:${audio.asset_id}`,
            itemId: item.id,
            src: `/api/media/${audio.asset_id}/play`,
            title: item.title,
            subtitle: item.show?.title ?? (byline || KIND_LABEL[item.kind]),
            artwork: cover,
            href: itemHref(item),
            duration: audio.duration_seconds,
            captions: audio.captions.map((c) => ({ src: `/api/media/${c.asset_id}/vtt`, label: c.label, language: c.language })),
            saveProgress: member && !preview,
          }}
        />
      ) : null}

      {item.kind === "book" ? (
        <>
          <BookAccess kindleUrl={book?.kindleUrl ?? null} audibleUrl={item.audible_url} />
          {book?.panel}
        </>
      ) : null}

      {item.kind === "playlist" && item.spotify_id ? (
        <section aria-label="Playlist">
          <EmbedPlayer
            autoload={!preview}
            title={`${item.title} on Spotify`}
            embed={spotifyEmbed({ provider: "spotify", kind: "playlist", id: item.spotify_id })}
            note="Spotify may play 30-second previews unless you're signed in to Spotify in this browser, and full playback can depend on your Spotify plan and device. Who can find the playlist itself is set in Spotify."
          />
        </section>
      ) : null}

      {item.kind === "assignment" ? (
        <section aria-label="This week's reading" className="space-y-3 rounded-card border border-border bg-surface p-5">
          {item.instructions ? <p className="text-lg font-semibold">{item.instructions}</p> : null}
          {member && !preview ? <CompleteToggle id={item.id} done={item.completed} /> : null}
          {member && !preview ? <p className="text-meta text-text-secondary">Only you can see whether you marked it done.</p> : null}
        </section>
      ) : null}

      {item.body.trim() ? <MarkdownBody source={item.body} className="reading-body" /> : null}

      {item.notes.trim() ? (
        <section aria-labelledby="notes-heading">
          <SectionHeading id="notes-heading">{item.kind === "lesson" ? "Lesson notes" : "Notes"}</SectionHeading>
          <MarkdownBody source={item.notes} className="reading-body" />
        </section>
      ) : null}

      {item.questions.length ? (
        <section aria-labelledby="questions-heading" className="rounded-card border border-border bg-surface p-5">
          <SectionHeading id="questions-heading">{QUESTION_TITLE[item.kind] ?? "Discussion questions"}</SectionHeading>
          <ol className="list-decimal space-y-2 pl-6">
            {item.questions.map((q, i) => (
              <li key={i} className="whitespace-pre-line [overflow-wrap:anywhere]">
                {q}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {files.length ? (
        <section aria-labelledby="files-heading">
          <SectionHeading id="files-heading">Handouts and resources</SectionHeading>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {files.map((a) => (
              <FileRow key={`${a.role}-${a.asset_id}`} a={a} />
            ))}
          </ul>
        </section>
      ) : null}

      {withTranscript.map((a) => (
        <details key={a.asset_id} className="rounded-card border border-border bg-surface p-5">
          <summary className="cursor-pointer font-semibold">Transcript{withTranscript.length > 1 ? ` (${a.role})` : ""}</summary>
          <div className="mt-3 whitespace-pre-line text-text">{transcripts[a.asset_id]}</div>
        </details>
      ))}

      {item.discussion ? (
        <Link href={`/community/t/${item.discussion.thread_id}`} className="interactive flex items-center gap-3 rounded-card border border-border bg-surface p-4 hover:bg-surface-muted/60">
          <MessagesSquare className="size-6 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Join the discussion</span>
            <span className="block truncate text-meta text-text-secondary">
              {item.discussion.title}
              {item.discussion.group ? ` · ${item.discussion.group}` : ""} · {item.discussion.replies} repl{item.discussion.replies === 1 ? "y" : "ies"}
            </span>
          </span>
        </Link>
      ) : null}

      {item.attribution || contributors.length || item.attachments.some((a) => a.attribution) ? (
        <footer className="space-y-1 text-meta text-text-secondary">
          {contributors.length ? <p>With {contributors.join(", ")}</p> : null}
          {item.attribution ? <p>{item.attribution}</p> : null}
          {item.attachments
            .filter((a) => a.attribution)
            .map((a) => (
              <p key={a.asset_id}>{a.attribution}</p>
            ))}
        </footer>
      ) : null}

      {item.assignments?.length ? (
        <section aria-labelledby="assignments-heading">
          <SectionHeading id="assignments-heading">{item.kind === "book" ? "Reading assignments" : "Other weeks"}</SectionHeading>
          <ul className="space-y-3">
            {item.assignments.map((a) => (
              <li key={a.id}>
                <ItemCard item={a} urls={urls} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {item.related.length ? (
        <section aria-labelledby="related-heading">
          <SectionHeading id="related-heading">Related</SectionHeading>
          <ul className="space-y-3">
            {item.related.map((r) => (
              <li key={r.id}>
                <ItemCard item={r} urls={urls} showKind />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {preview && videos.some((v) => v.kind === "external_video") && item.audience !== "public" ? (
        <Alert tone="info" title="External video privacy">
          This page is limited to {item.audience === "group" ? "one group" : "members"}, but the video itself is on {video?.provider === "vimeo" ? "Vimeo" : "YouTube"}.
          Its privacy is set there: an unlisted video can be watched by anyone who has its link.
        </Alert>
      ) : null}
    </article>
  );
}
