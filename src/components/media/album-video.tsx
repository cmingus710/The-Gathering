"use client";

import { Flag } from "lucide-react";
import { useState } from "react";
import type { VideoInfo } from "@/lib/media/types";
import { ReportForm } from "./gallery-viewer";
import { VideoPlayer } from "./video-player";

/**
 * A video in a Media gallery album: plays in place, with its caption and
 * the same "Report or ask to remove" request as photos.
 */
export function AlbumVideo({ id, video, caption, albumTitle }: { id: string; video: VideoInfo; caption: string; albumTitle: string }) {
  const [reporting, setReporting] = useState(false);
  return (
    <div className="space-y-2 rounded-card border border-border bg-surface p-3">
      <VideoPlayer video={video} title={caption || `${albumTitle}: ${video.title}`} caption={caption || null} compact />
      {reporting ? (
        <div className="rounded-tile border border-border bg-surface-muted p-3">
          <ReportForm photoId={id} noun="video" onDone={() => setReporting(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReporting(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-meta font-semibold text-text-secondary hover:bg-surface-muted"
        >
          <Flag className="size-4" aria-hidden="true" /> Report or ask to remove<span className="sr-only">: {caption || video.title}</span>
        </button>
      )}
    </div>
  );
}
