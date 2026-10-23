"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { claimPlayback, registerPlayer, releasePlayback } from "@/lib/media/coordinator";
import { formatDuration } from "@/lib/media/format";
import { saveProgress } from "@/lib/media/player-actions";

/**
 * Church-hosted video: the browser's own controls (keyboard and screen
 * reader accessible, with fullscreen and caption menus), plus a playback
 * speed choice and the member's saved position. Captions load from this
 * site (/api/media/<id>/vtt) after an access check. Starting the video
 * pauses the audio player and any embed. Delivered as progressive MP4 (no
 * adaptive streaming), so it needs a reasonably steady connection.
 */
export function NativeVideo({
  assetId,
  itemId,
  title,
  poster,
  captions,
  resumeAt,
  saveProgressFor,
  preload = "metadata",
}: {
  assetId: string;
  itemId: string;
  title: string;
  poster?: string | null;
  captions: Array<{ asset_id: string; label: string; language: string }>;
  resumeAt?: number | null;
  saveProgressFor: boolean;
  /** "none" in lists and galleries: nothing is downloaded until Play. */
  preload?: "none" | "metadata";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const id = `video:${assetId}`;
  const rateId = useId();
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [resumeShown, setResumeShown] = useState<number | null>(resumeAt && resumeAt > 5 ? resumeAt : null);
  const retried = useRef(false);
  const lastSaved = useRef(0);
  const key = `a:${assetId}`;

  useEffect(() => registerPlayer(id, { pause: () => ref.current?.pause() }), [id]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const persist = (completed = false) => {
      if (!saveProgressFor) return;
      lastSaved.current = Date.now();
      void saveProgress(key, itemId, completed ? 0 : v.currentTime, Number.isFinite(v.duration) ? v.duration : null, completed).catch(() => undefined);
    };
    const onPlay = () => {
      claimPlayback(id);
      setError(null);
    };
    const onPause = () => {
      releasePlayback(id);
      persist();
    };
    const onTime = () => {
      if (!v.paused && Date.now() - lastSaved.current > 15_000) persist();
    };
    const onEnded = () => persist(true);
    const onError = () => {
      const code = v.error?.code;
      if (!retried.current && code !== MediaError.MEDIA_ERR_ABORTED) {
        // The short-lived link may have expired: fetch a fresh one once.
        retried.current = true;
        const at = v.currentTime;
        v.src = `/api/media/${assetId}/play`;
        v.addEventListener("loadedmetadata", () => (v.currentTime = at), { once: true });
        return;
      }
      setError(
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? "This video can't be played here. It may no longer be available to you, or this browser can't play its format."
          : "The video couldn't be loaded. Check your connection, then try again.",
      );
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
    };
  }, [assetId, id, itemId, key, saveProgressFor]);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-card bg-black shadow-(--elev-card)">
        <video
          ref={ref}
          controls
          playsInline
          preload={preload}
          poster={poster ?? undefined}
          className="aspect-video w-full bg-black"
          aria-label={title}
          src={`/api/media/${assetId}/play`}
        >
          {captions.map((c, i) => (
            <track key={c.asset_id} kind="captions" src={`/api/media/${c.asset_id}/vtt`} srcLang={c.language} label={c.label} default={i === 0} />
          ))}
          Your browser can&apos;t play this video.
        </video>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {resumeShown ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const v = ref.current;
              if (!v) return;
              v.currentTime = resumeShown;
              setResumeShown(null);
              void v.play().catch(() => undefined);
            }}
          >
            Resume at {formatDuration(resumeShown)}
          </Button>
        ) : null}
        <label htmlFor={rateId} className="text-meta text-text-secondary">
          Speed
        </label>
        <select
          id={rateId}
          value={rate}
          onChange={(e) => {
            const r = Number(e.target.value);
            setRate(r);
            if (ref.current) ref.current.playbackRate = r;
          }}
          className="min-h-11 rounded-full border border-border bg-surface px-3 text-meta font-semibold text-text"
        >
          {[0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-tile bg-danger-soft px-3 py-2 text-meta text-text">
          <span>{error}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              retried.current = false;
              setError(null);
              ref.current?.load();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
