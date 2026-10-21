"use client";

import { Pause, Play } from "lucide-react";
import { formatDuration } from "@/lib/media/format";
import { PlayerControls } from "./player-controls";
import { usePlayer, type Track } from "./player-provider";

/**
 * The in-card audio player on the Podcasts page. It drives the app's one
 * persistent player (so only one episode plays at a time, playback carries
 * on across pages and on the lock screen, and speed and resume work as on
 * the episode page). Nothing loads until Play is pressed; while this
 * episode is the current track its full controls show in the card.
 */
export function EpisodePlayer({ track, resumeAt }: { track: Track; resumeAt?: number | null }) {
  const player = usePlayer();
  const current = player?.track?.key === track.key;
  const playing = current && (player?.status === "playing" || player?.status === "loading");
  const resume = !current && resumeAt && resumeAt > 5 && (!track.duration || resumeAt < track.duration - 10) ? resumeAt : null;
  const dur = track.duration ?? null;
  // Before the first play, a read-only bar shows where it would start.
  const startAt = resume ?? 0;
  if (!player) return null;
  return (
    <div className="rounded-tile bg-surface-muted/70 p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (current ? player.toggle() : player.play(track, resume ?? undefined))}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-cta text-on-cta transition-colors hover:bg-cta-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={playing ? `Pause ${track.title}` : resume ? `Resume ${track.title}` : `Play ${track.title}`}
        >
          {playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5 translate-x-px" aria-hidden="true" />}
        </button>
        {current ? (
          <p className="min-w-0 flex-1 text-meta text-text-secondary" aria-live="polite">
            {player.status === "loading" ? "Loading…" : player.status === "playing" ? "Playing" : player.status === "error" ? "Playback stopped" : player.status === "ended" ? "Finished" : "Paused"}
          </p>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden="true">
            <div className="h-1.5 overflow-hidden rounded-full bg-border/70">
              <div className="h-full rounded-full bg-accent" style={{ width: dur && startAt ? `${Math.min(100, (startAt / dur) * 100)}%` : "0%" }} />
            </div>
            <div className="mt-1 flex justify-between text-[0.8125rem] tabular-nums text-text-secondary">
              <span>{resume ? `Resume at ${formatDuration(resume)}` : formatDuration(0)}</span>
              <span>{formatDuration(dur)}</span>
            </div>
          </div>
        )}
      </div>
      {current ? (
        <div className="mt-3">
          <PlayerControls player={player} />
        </div>
      ) : null}
    </div>
  );
}
