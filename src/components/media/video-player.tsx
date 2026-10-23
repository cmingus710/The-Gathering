"use client";

/* eslint-disable @next/next/no-img-element -- access-checked thumbnails from this app, never through the image optimizer */
import { ExternalLink, Film, Play } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { claimPlayback, registerPlayer, releasePlayback } from "@/lib/media/coordinator";
import { EMBED_ORIGINS, storedVideoRef, videoEmbed } from "@/lib/media/embeds";
import { formatDuration } from "@/lib/media/format";
import type { VideoInfo } from "@/lib/media/types";
import { NativeVideo } from "./native-video";

const PROVIDER_NAME = { youtube: "YouTube", vimeo: "Vimeo" } as const;

/**
 * The one video presentation used everywhere (search, Videos, the Media
 * gallery, lessons, devotionals, church reading, workbooks).
 *
 * YouTube/Vimeo: a poster (the provider's thumbnail, fetched through this
 * app after an access check) and a Play button. Pressing Play once swaps in
 * the provider's player in the same place with autoplay, so the click is
 * the user gesture that starts it; nothing is requested from the provider
 * before that, and nothing autoplays on page load. Browsers that refuse
 * autoplay inside a frame (notably iOS/iPadOS Safari for YouTube) show the
 * provider's own play button instead, which then needs a second tap. Errors
 * the player reports (embedding disabled, removed, private) replace it with
 * an "Open in …" link, which is always shown below as well.
 *
 * Uploaded videos: the browser's own player with preload="none", so the
 * first press of Play starts it and lists download nothing beforehand.
 */
export function VideoPlayer({
  video,
  title,
  itemId,
  caption,
  poster,
  resumeAt,
  saveProgress = false,
  compact = false,
  className,
}: {
  video: VideoInfo;
  /** Accessible name (usually the content's title). */
  title: string;
  /** For saved positions of uploaded video. */
  itemId?: string;
  /** A short contextual note shown under the player. */
  caption?: string | null;
  /** A chosen poster (the content's cover); otherwise the provider's thumbnail. */
  poster?: string | null;
  resumeAt?: number | null;
  saveProgress?: boolean;
  /** Cards: tighter spacing below the player. */
  compact?: boolean;
  className?: string;
}) {
  const ref = video.kind === "external_video" ? storedVideoRef(video) : null;
  return (
    <figure className={cn("space-y-2", className)}>
      {ref ? (
        <ExternalVideo video={video} title={title} compact={compact} poster={poster} />
      ) : video.kind === "video" ? (
        <NativeVideo
          assetId={video.asset_id}
          itemId={itemId ?? video.asset_id}
          title={title}
          poster={poster}
          captions={video.captions}
          resumeAt={resumeAt}
          saveProgressFor={saveProgress && !!itemId}
          preload="none"
        />
      ) : (
        <p className="rounded-card border border-border bg-surface-muted p-5 text-meta text-text-secondary">This video isn&apos;t available.</p>
      )}
      {caption ? <figcaption className="text-meta text-text-secondary">{caption}</figcaption> : null}
    </figure>
  );
}

type State = "idle" | "playing" | "failed";

function ExternalVideo({ video, title, compact, poster }: { video: VideoInfo; title: string; compact: boolean; poster?: string | null }) {
  const ref = storedVideoRef(video)!;
  const name = PROVIDER_NAME[ref.provider];
  const [state, setState] = useState<State>(video.unavailable ? "failed" : "idle");
  const [thumbOk, setThumbOk] = useState(!!poster || video.has_thumb);
  const [origin, setOrigin] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const id = `video:${useId()}`;
  const origins = EMBED_ORIGINS[ref.provider] as readonly string[];
  const embed = videoEmbed(ref, { origin, autoplay: true });
  const duration = video.duration_seconds ? formatDuration(video.duration_seconds) : null;

  const post = useCallback(
    (message: unknown) => {
      const w = frame.current?.contentWindow;
      if (!w) return;
      for (const o of origins) w.postMessage(JSON.stringify(message), o);
    },
    [origins],
  );

  useEffect(
    () =>
      registerPlayer(id, {
        pause: () => {
          if (ref.provider === "youtube") post({ event: "command", func: "pauseVideo", args: [] });
          else post({ method: "pause" });
        },
      }),
    [id, post, ref.provider],
  );

  useEffect(() => {
    if (state !== "playing") {
      releasePlayback(id);
      return;
    }
    const onMessage = (e: MessageEvent) => {
      if (!origins.includes(e.origin) || e.source !== frame.current?.contentWindow) return;
      let data: unknown = e.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const d = data as { event?: string; info?: { playerState?: number } | number };
      const ytPlaying = d.event === "onStateChange" ? d.info === 1 : d.event === "infoDelivery" && typeof d.info === "object" && d.info?.playerState === 1;
      if (ytPlaying || (ref.provider === "vimeo" && d.event === "play")) claimPlayback(id);
      // YouTube: 2 bad request, 5 can't play here, 100 removed or private, 101/150 owner blocks embedding.
      if ((ref.provider === "youtube" && d.event === "onError") || (ref.provider === "vimeo" && d.event === "error")) setState("failed");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, origins, ref.provider, state]);

  const onLoad = () => {
    // Ask for state and error events (both providers' documented message APIs), and
    // ask YouTube to play, for browsers that ignore autoplay but allow the API call.
    if (ref.provider === "youtube") {
      post({ event: "listening", id, channel: "widget" });
      post({ event: "command", func: "playVideo", args: [] });
    } else {
      post({ method: "addEventListener", value: "play" });
      post({ method: "addEventListener", value: "error" });
    }
    frame.current?.focus();
  };

  return (
    <>
      <div className="relative aspect-video overflow-hidden rounded-card bg-black">
        {state === "playing" ? (
          <iframe
            ref={frame}
            src={embed.src}
            title={`${title} (${name} video)`}
            allow={embed.allow}
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full border-0"
            onLoad={onLoad}
          />
        ) : (
          <>
            {thumbOk ? (
              <img
                src={poster ?? `/api/media/${video.asset_id}/thumb`}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setThumbOk(false)}
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-muted to-border" aria-hidden="true">
                <Film className="size-12 text-text-secondary" />
              </span>
            )}
            {state === "failed" ? (
              <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-4 text-center text-white">
                <p className="max-w-sm text-meta font-semibold">This video can&apos;t be played here. It may be private, removed, or limited to {name}.</p>
                <a
                  href={embed.openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 font-semibold text-black hover:bg-white/90"
                >
                  {embed.openLabel}
                  <ExternalLink className="size-4" aria-hidden="true" />
                  <span className="sr-only">(opens a new tab)</span>
                </a>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  claimPlayback(id);
                  setOrigin(window.location.origin);
                  setState("playing");
                }}
                className="group absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/45 via-black/5 to-transparent focus-visible:outline-none"
              >
                <span className="sr-only">
                  Play {title} ({name})
                </span>
                <span
                  aria-hidden="true"
                  className="flex size-16 items-center justify-center rounded-full bg-cta text-on-cta shadow-(--elev-lift) transition-transform group-hover:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-white sm:size-[4.5rem]"
                >
                  <Play className="ml-1 size-8 fill-current" />
                </span>
                <span aria-hidden="true" className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2.5 py-0.5 text-[0.75rem] font-semibold text-white">
                  {name}
                </span>
                {duration ? (
                  <span aria-hidden="true" className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2.5 py-0.5 text-[0.75rem] font-semibold text-white">
                    {duration}
                  </span>
                ) : null}
              </button>
            )}
          </>
        )}
      </div>
      <div className={cn("flex flex-wrap items-center justify-between gap-x-3", compact ? "gap-y-0" : "gap-y-1")}>
        <p className="text-[0.8125rem] text-text-secondary">
          {state === "playing" ? `Playing from ${name}.` : `Plays from ${name} when you press Play.`}
        </p>
        <a
          href={embed.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-meta font-semibold text-primary hover:bg-primary-soft"
        >
          {embed.openLabel}
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only">(opens a new tab)</span>
        </a>
      </div>
    </>
  );
}
