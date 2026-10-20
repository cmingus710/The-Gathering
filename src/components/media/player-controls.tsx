"use client";

import { Captions, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/media/format";
import type { usePlayer } from "./player-provider";

type Player = NonNullable<ReturnType<typeof usePlayer>>;

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Full controls for the current track (mini-player panel and inline cards). */
export function PlayerControls({ player }: { player: Player }) {
  const seekId = useId();
  const rateId = useId();
  const volumeId = useId();
  const dur = player.duration ?? 0;
  const hasCaptions = !!player.track?.captions?.length;
  return (
    <div className="space-y-2.5">
      {player.status === "error" && player.error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-tile bg-danger-soft px-3 py-2 text-meta text-text">
          <span>{player.error}</span>
          <Button size="sm" variant="secondary" onClick={player.retry}>
            Try again
          </Button>
        </div>
      ) : null}
      <div>
        <label htmlFor={seekId} className="sr-only">
          Playback position
        </label>
        <input
          id={seekId}
          type="range"
          min={0}
          max={Math.max(1, Math.floor(dur))}
          step={1}
          value={Math.min(Math.floor(player.position), Math.max(1, Math.floor(dur)))}
          onChange={(e) => player.seek(Number(e.target.value))}
          disabled={!dur}
          aria-valuetext={`${formatDuration(player.position)} of ${formatDuration(player.duration)}`}
          className="media-range w-full"
        />
        <div className="flex justify-between text-[0.8125rem] tabular-nums text-text-secondary" aria-hidden="true">
          <span>{formatDuration(player.position)}</span>
          <span>{dur ? `−${formatDuration(Math.max(0, dur - player.position))}` : formatDuration(null)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => player.skip(-15)} className="media-icon-btn" aria-label="Back 15 seconds">
          <RotateCcw className="size-5" aria-hidden="true" />
          <span className="text-[0.6875rem] font-bold" aria-hidden="true">
            15
          </span>
        </button>
        <button type="button" onClick={() => player.skip(30)} className="media-icon-btn" aria-label="Forward 30 seconds">
          <RotateCw className="size-5" aria-hidden="true" />
          <span className="text-[0.6875rem] font-bold" aria-hidden="true">
            30
          </span>
        </button>
        <label htmlFor={rateId} className="sr-only">
          Playback speed
        </label>
        <select
          id={rateId}
          value={player.rate}
          onChange={(e) => player.setRate(Number(e.target.value))}
          className="min-h-11 rounded-full border border-border bg-surface px-3 text-meta font-semibold text-text"
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        {hasCaptions ? (
          <button
            type="button"
            onClick={player.toggleCaptions}
            className="media-icon-btn"
            aria-pressed={player.showCaptions}
            aria-label="Show captions"
          >
            <Captions className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={player.toggleMute} className="media-icon-btn" aria-label={player.muted ? "Unmute" : "Mute"} aria-pressed={player.muted}>
            {player.muted ? <VolumeX className="size-5" aria-hidden="true" /> : <Volume2 className="size-5" aria-hidden="true" />}
          </button>
          <label htmlFor={volumeId} className="sr-only">
            Volume
          </label>
          <input
            id={volumeId}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={player.muted ? 0 : player.volume}
            onChange={(e) => player.setVolume(Number(e.target.value))}
            className="media-range w-24"
            aria-valuetext={`${Math.round((player.muted ? 0 : player.volume) * 100)}%`}
          />
        </div>
      </div>
      {hasCaptions && player.showCaptions ? (
        <p aria-live="polite" className="min-h-6 rounded-tile bg-surface-muted px-3 py-1.5 text-meta text-text">
          {player.cue ?? " "}
        </p>
      ) : null}
    </div>
  );
}
